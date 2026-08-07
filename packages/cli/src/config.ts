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

export function resolveAuthUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const configured = env[AUTH_URL_ENV_VAR];
  const raw =
    configured !== undefined && configured.trim().length > 0 ? configured : DEFAULT_AUTH_URL;
  return raw.trim().replace(/\/+$/, '');
}

const projectConfigSchema = z.object({
  workspace: z.string().min(1),
  project: z.string().min(1),
  endpoint: z.string().url().optional(),
});

export type ProjectConfigFile = z.infer<typeof projectConfigSchema>;

export interface ProjectConfig {
  readonly workspace: string;
  readonly project: string;
  readonly endpoint: string;
  readonly configPath: string;
  readonly repoRoot: string;
}

export function configPathFor(cwd: string): string {
  return join(resolve(cwd), CONFIG_DIR, CONFIG_FILE);
}

export function notConfiguredError(cwd: string): CliError {
  return new CliError(
    'not_configured',
    `no Mneia project is bound to ${resolve(cwd)} — neither ${configPathFor(cwd)} nor ~/.mneia/local.json exists`,
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

  const endpoint = env[ENDPOINT_ENV_VAR] ?? result.data.endpoint ?? DEFAULT_ENDPOINT;

  return {
    workspace: result.data.workspace,
    project: result.data.project,
    endpoint,
    configPath: path,
    repoRoot: resolve(cwd),
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

  const { loadLocalBinding, localConfigPath } = await import('./local-store.js');
  const binding = await loadLocalBinding(env);
  if (binding === null) {
    throw notConfiguredError(cwd);
  }

  return {
    workspace: binding.workspaceId,
    project: binding.projectSlug ?? binding.projectId ?? '',
    endpoint: env[ENDPOINT_ENV_VAR] ?? DEFAULT_ENDPOINT,
    configPath: localConfigPath(env),
    repoRoot: resolve(cwd),
  };
}

export function credentialsPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env.MNEIA_CREDENTIALS_PATH;
  if (override !== undefined && override.length > 0 && isAbsolute(override)) {
    return override;
  }
  return join(homedir(), CONFIG_DIR, 'credentials');
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
