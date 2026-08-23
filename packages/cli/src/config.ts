import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import { CliError } from './command.js';

export const CONFIG_DIR = '.mneia';
export const CONFIG_FILE = 'config.json';
export const CREDENTIALS_ENV_VAR = 'MNEIA_TOKEN';
export const ENDPOINT_ENV_VAR = 'MNEIA_API_URL';
export const DEFAULT_ENDPOINT = 'https://app.mneia.dev';
export const AUTH_URL_ENV_VAR = 'MNEIA_AUTH_URL';
export const DEFAULT_AUTH_URL = 'https://app.mneia.dev';
export const HOME_ENV_VAR = 'MNEIA_HOME';

export function mneiaHomeDir(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env[HOME_ENV_VAR];
  if (override !== undefined && override.trim().length > 0 && isAbsolute(override.trim())) {
    return override.trim();
  }
  return join(homedir(), CONFIG_DIR);
}

export function resolveAuthUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env[AUTH_URL_ENV_VAR];
  const raw =
    configured !== undefined && configured.trim().length > 0 ? configured : DEFAULT_AUTH_URL;
  return raw.trim().replace(/\/+$/, '');
}

export function resolveEndpoint(
  env: Readonly<Record<string, string | undefined>>,
  configured: string | undefined,
): string {
  const fromEnv = env[ENDPOINT_ENV_VAR];
  const raw =
    fromEnv !== undefined && fromEnv.trim().length > 0
      ? { value: fromEnv.trim(), source: `${ENDPOINT_ENV_VAR}` }
      : configured !== undefined && configured.trim().length > 0
        ? { value: configured.trim(), source: 'the endpoint in .mneia/config.json' }
        : { value: DEFAULT_ENDPOINT, source: 'the default' };

  let parsed: URL;
  try {
    parsed = new URL(raw.value);
  } catch {
    throw new CliError(
      'not_configured',
      `${raw.source} is "${raw.value}", which is not an absolute URL`,
      `set ${ENDPOINT_ENV_VAR} to an absolute http or https URL such as ${DEFAULT_ENDPOINT}, or unset it to use the default`,
    );
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new CliError(
      'not_configured',
      `${raw.source} is "${raw.value}", whose scheme is ${parsed.protocol.replace(':', '')} rather than http or https`,
      `set ${ENDPOINT_ENV_VAR} to an http or https URL such as ${DEFAULT_ENDPOINT}, or unset it to use the default`,
    );
  }

  return raw.value;
}

const projectConfigSchema = z.object({
  workspace: z.string().min(1),
  project: z.string().min(1),
  endpoint: z.string().url().optional(),
  // When this repo was bound. Sessions that started before it are never checkpointed:
  // context from before Mneia was installed is out of scope and is not recoverable.
  // Optional because bindings written before this field existed do not carry one.
  boundAt: z.string().datetime().optional(),
});

export type ProjectConfigFile = z.infer<typeof projectConfigSchema>;

export interface ProjectConfig {
  readonly workspace: string;
  readonly project: string;
  readonly endpoint: string;
  readonly configPath: string;
  readonly repoRoot: string;
  readonly boundAt: Date | null;
}

export function configPathFor(cwd: string): string {
  return join(resolve(cwd), CONFIG_DIR, CONFIG_FILE);
}

export function notConfiguredError(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CliError {
  return new CliError(
    'not_configured',
    `no Mneia project is bound to ${resolve(cwd)} — neither ${configPathFor(cwd)} nor ${join(mneiaHomeDir(env), 'local.json')} exists`,
    'run mneia login to sign this machine in, then mneia init to bind this repo to a project',
  );
}

function malformedConfigError(path: string, detail: string): CliError {
  return new CliError(
    'not_configured',
    `${path} is not a valid Mneia project config: ${detail}`,
    'fix the field named above, or delete the file and run mneia init',
  );
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${field}: ${issue.message}`;
    })
    .join('; ');
}

export async function loadProjectConfig(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ProjectConfig | null> {
  const path = configPathFor(cwd);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if (isNotFound(cause)) {
      return null;
    }
    throw new CliError(
      'failed',
      `could not read ${path}: ${describeCause(cause)}`,
      'check the file permissions on .mneia/config.json',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw malformedConfigError(path, `not valid JSON (${describeCause(cause)})`);
  }

  const result = projectConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw malformedConfigError(path, describeIssues(result.error));
  }

  return {
    workspace: result.data.workspace,
    project: result.data.project,
    endpoint: resolveEndpoint(env, result.data.endpoint),
    configPath: path,
    repoRoot: resolve(cwd),
    boundAt: result.data.boundAt === undefined ? null : new Date(result.data.boundAt),
  };
}

export async function requireProjectConfig(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ProjectConfig> {
  const config = await loadProjectConfig(cwd, env);
  if (config !== null) {
    return config;
  }

  const { loadLocalBinding, localConfigPath } = await import('./local-binding.js');
  const binding = await loadLocalBinding(env);
  if (binding === null) {
    throw notConfiguredError(cwd, env);
  }

  return {
    workspace: binding.workspaceId,
    project: binding.projectSlug ?? binding.projectId ?? '',
    endpoint: resolveEndpoint(env, undefined),
    configPath: localConfigPath(env),
    repoRoot: resolve(cwd),
    boundAt: null,
  };
}

export function credentialsPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env.MNEIA_CREDENTIALS_PATH;
  if (override !== undefined && override.length > 0 && isAbsolute(override)) {
    return override;
  }
  return join(mneiaHomeDir(env), 'credentials');
}

export async function resolveToken(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<string> {
  const fromEnv = env[CREDENTIALS_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }

  const path = credentialsPath(env);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if (isNotFound(cause)) {
      throw new CliError(
        'auth',
        `no Mneia credentials found — ${CREDENTIALS_ENV_VAR} is unset and ${path} does not exist`,
        `run mneia login, or set ${CREDENTIALS_ENV_VAR} in CI`,
      );
    }
    throw new CliError(
      'auth',
      `could not read ${path}: ${describeCause(cause)}`,
      'check the file permissions, or run mneia login again',
    );
  }

  const token = raw.trim();
  if (token.length === 0) {
    throw new CliError('auth', `${path} is empty`, 'run mneia login to obtain a token');
  }
  return token;
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { code?: unknown }).code === 'ENOENT'
  );
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
