import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { telemetryEnabledIn } from '@mneia/core';
import { z } from 'zod';

export const TOKEN_ENV_VAR = 'MNEIA_TOKEN';
export const ENDPOINT_ENV_VAR = 'MNEIA_API_URL';
export const TELEMETRY_ENV_VAR = 'MNEIA_TELEMETRY';
export const CREDENTIALS_PATH_ENV_VAR = 'MNEIA_CREDENTIALS_PATH';
export const LOCAL_CONFIG_PATH_ENV_VAR = 'MNEIA_LOCAL_CONFIG';
export const HOME_ENV_VAR = 'MNEIA_HOME';
export const DATABASE_URL_ENV_VAR = 'DATABASE_URL';

export const DEFAULT_ENDPOINT = 'https://app.mneia.dev';
export const CONFIG_DIR = '.mneia';
export const CONFIG_FILE = 'config.json';
export const CREDENTIALS_FILE = 'credentials';
export const LOCAL_CONFIG_FILE = 'local.json';
export const EVENTS_FILE = 'events.jsonl';
export const REVIEW_QUEUE_FILE = 'review-queue.jsonl';

export const TELEMETRY_OFF_VALUES = ['off', 'false', 'no', 'none', '0'] as const;
export const TELEMETRY_ON_VALUES = ['on', 'true', 'yes', '1'] as const;

const ACCEPTED_TELEMETRY_VALUES = new Set<string>([
  ...TELEMETRY_OFF_VALUES,
  ...TELEMETRY_ON_VALUES,
]);

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export type EnvLike = Readonly<Record<string, string | undefined>>;

export type FileReader = (path: string) => Promise<string>;

export interface ProjectBinding {
  readonly workspace: string;
  readonly project: string;
  readonly configPath: string;
}

export interface LocalBinding {
  readonly databaseUrl: string;
  readonly databaseUrlSource: string;
  readonly workspaceId: string;
  readonly agentActorId: string;
  readonly humanActorId: string | null;
  readonly projectId: string | null;
  readonly projectSlug: string | null;
  readonly telemetryPath: string;
  readonly reviewQueuePath: string;
  readonly configPath: string;
}

interface ServerConfigBase {
  readonly telemetryEnabled: boolean;
  readonly project: ProjectBinding | null;
  readonly cwd: string;
}

export interface LocalServerConfig extends ServerConfigBase {
  readonly mode: 'local';
  readonly local: LocalBinding;
}

export interface HostedServerConfig extends ServerConfigBase {
  readonly mode: 'hosted';
  readonly token: string;
  readonly endpoint: string;
}

export type ServerConfig = LocalServerConfig | HostedServerConfig;

export interface LoadServerConfigOptions {
  readonly env?: EnvLike | undefined;
  readonly cwd?: string | undefined;
  readonly readTextFile?: FileReader | undefined;
}

export class ConfigError extends Error {
  readonly variable: string;
  readonly summary: string;
  readonly remedy: string;

  constructor(variable: string, summary: string, remedy: string) {
    super(`${summary} ${remedy}`);
    this.name = 'ConfigError';
    this.variable = variable;
    this.summary = summary;
    this.remedy = remedy;
  }
}

const TOKEN_SHAPE = /^[!-~]+$/u;

const tokenSchema = z.string().trim().min(1).regex(TOKEN_SHAPE);

const endpointSchema = z.url();

const projectConfigSchema = z.object({
  workspace: z.string().trim().min(1),
  project: z.string().trim().min(1),
  endpoint: z.url().optional(),
});

const localConfigSchema = z.object({
  databaseUrl: z.string().trim().min(1).optional(),
  workspaceId: z.uuid(),
  agentActorId: z.uuid(),
  humanActorId: z.uuid().optional(),
  projectId: z.uuid().optional(),
  projectSlug: z.string().trim().min(1).optional(),
  telemetryPath: z.string().trim().min(1).optional(),
  reviewQueuePath: z.string().trim().min(1).optional(),
});

export function projectConfigPath(cwd: string): string {
  return join(resolve(cwd), CONFIG_DIR, CONFIG_FILE);
}

export function mneiaHomeDir(env: EnvLike): string {
  const override = env[HOME_ENV_VAR];
  if (override !== undefined && override.trim().length > 0 && isAbsolute(override.trim())) {
    return override.trim();
  }
  return join(homedir(), CONFIG_DIR);
}

function homeConfigPath(env: EnvLike, fileName: string): string {
  return join(mneiaHomeDir(env), fileName);
}

export function credentialsPath(env: EnvLike): string {
  const override = env[CREDENTIALS_PATH_ENV_VAR];
  if (override !== undefined && override.trim().length > 0 && isAbsolute(override.trim())) {
    return override.trim();
  }
  return homeConfigPath(env, CREDENTIALS_FILE);
}

export function localConfigPath(env: EnvLike): string {
  const override = env[LOCAL_CONFIG_PATH_ENV_VAR];
  if (override !== undefined && override.trim().length > 0) {
    return resolve(override.trim());
  }
  return homeConfigPath(env, LOCAL_CONFIG_FILE);
}

export function describeDatabaseTarget(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const database = parsed.pathname.replace(/^\//u, '');
    return database.length > 0 ? `${parsed.host}/${database}` : parsed.host;
  } catch {
    return 'an unparseable connection string';
  }
}

function defaultReadTextFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    (cause as { readonly code?: unknown }).code === 'ENOENT'
  );
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return String(cause);
}

function describeIssues(error: z.ZodError<unknown>): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.');
      return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

function validateToken(source: string, raw: string): string {
  const result = tokenSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  throw new ConfigError(
    TOKEN_ENV_VAR,
    `${source} is not a usable Mneia token: it must be a single run of printable characters with no spaces, and it is not.`,
    `Set ${TOKEN_ENV_VAR} to the token value alone — no "Bearer " prefix, no quotes, no trailing newline.`,
  );
}

async function resolveToken(env: EnvLike, readTextFile: FileReader): Promise<string> {
  const fromEnv = env[TOKEN_ENV_VAR];
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return validateToken(TOKEN_ENV_VAR, fromEnv);
  }

  const localPath = localConfigPath(env);

  if (fromEnv !== undefined) {
    throw new ConfigError(
      TOKEN_ENV_VAR,
      `${TOKEN_ENV_VAR} is set but empty, so this server has no way to authenticate.`,
      `Set ${TOKEN_ENV_VAR} to a Mneia token in the MCP client's server config, or unset it and write ${localPath} to run this server against a Postgres store directly.`,
    );
  }

  const path = credentialsPath(env);
  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch (cause) {
    if (isNotFound(cause)) {
      throw new ConfigError(
        TOKEN_ENV_VAR,
        `this server has no store to talk to: ${TOKEN_ENV_VAR} is unset, ${path} does not exist, and ${localPath} does not exist either.`,
        `Write ${localPath} with databaseUrl, workspaceId and agentActorId to run against a Postgres store directly, or set ${TOKEN_ENV_VAR} in the MCP client's server config to use the hosted API.`,
      );
    }
    throw new ConfigError(
      TOKEN_ENV_VAR,
      `${path} could not be read: ${describeCause(cause)}.`,
      `Check the file permissions, or set ${TOKEN_ENV_VAR} instead.`,
    );
  }

  if (raw.trim().length === 0) {
    throw new ConfigError(
      TOKEN_ENV_VAR,
      `${path} is empty, so this server has no way to authenticate.`,
      `Delete it and set ${TOKEN_ENV_VAR} instead, or write ${localPath} to run against a Postgres store directly.`,
    );
  }

  return validateToken(path, raw);
}

function resolveEndpoint(env: EnvLike, fromProjectConfig: string | undefined): string {
  const configured = env[ENDPOINT_ENV_VAR];
  if (configured === undefined) {
    return fromProjectConfig ?? DEFAULT_ENDPOINT;
  }

  const candidate = configured.trim();
  const result = endpointSchema.safeParse(candidate);
  if (!result.success) {
    throw new ConfigError(
      ENDPOINT_ENV_VAR,
      `${ENDPOINT_ENV_VAR} is not an absolute URL; received "${configured}".`,
      `Set ${ENDPOINT_ENV_VAR} to an absolute https URL such as ${DEFAULT_ENDPOINT}, or unset it to use ${DEFAULT_ENDPOINT}.`,
    );
  }

  const protocol = new URL(result.data).protocol;
  if (protocol !== 'https:' && protocol !== 'http:') {
    throw new ConfigError(
      ENDPOINT_ENV_VAR,
      `${ENDPOINT_ENV_VAR} must use http or https; received the "${protocol.replace(':', '')}" scheme.`,
      `Set ${ENDPOINT_ENV_VAR} to an absolute https URL such as ${DEFAULT_ENDPOINT}, or unset it to use ${DEFAULT_ENDPOINT}.`,
    );
  }

  return result.data;
}

function resolveTelemetryEnabled(env: EnvLike): boolean {
  const configured = env[TELEMETRY_ENV_VAR];
  if (configured === undefined) {
    return true;
  }

  const normalised = configured.trim().toLowerCase();
  if (!ACCEPTED_TELEMETRY_VALUES.has(normalised)) {
    throw new ConfigError(
      TELEMETRY_ENV_VAR,
      `${TELEMETRY_ENV_VAR} is set to "${configured}", which is neither on nor off, and a typo here would silently leave telemetry on.`,
      `Set ${TELEMETRY_ENV_VAR} to one of ${TELEMETRY_OFF_VALUES.join(', ')} to opt out, or one of ${TELEMETRY_ON_VALUES.join(', ')} to opt in, or unset it to keep the default.`,
    );
  }

  return telemetryEnabledIn({ [TELEMETRY_ENV_VAR]: normalised });
}

async function loadProjectBinding(
  cwd: string,
  readTextFile: FileReader,
): Promise<{ readonly binding: ProjectBinding; readonly endpoint: string | undefined } | null> {
  const path = projectConfigPath(cwd);

  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch (cause) {
    if (isNotFound(cause)) {
      return null;
    }
    throw new ConfigError(
      path,
      `${path} could not be read: ${describeCause(cause)}.`,
      'Check the file permissions on .mneia/config.json, or delete it and let the tool calls name the project instead.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(
      path,
      `${path} is not valid JSON: ${describeCause(cause)}.`,
      'Fix the JSON, or delete the file and pass the project name to each tool call instead.',
    );
  }

  const result = projectConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      path,
      `${path} is not a valid Mneia project binding — ${describeIssues(result.error)}.`,
      'Fix the field named above, or delete the file and pass the project name to each tool call instead.',
    );
  }

  return {
    binding: {
      workspace: result.data.workspace,
      project: result.data.project,
      configPath: path,
    },
    endpoint: result.data.endpoint,
  };
}

function resolveDatabaseUrl(
  path: string,
  env: EnvLike,
  fromFile: string | undefined,
): { readonly databaseUrl: string; readonly source: string } {
  const fromEnv = env[DATABASE_URL_ENV_VAR];
  const candidate =
    fromFile ?? (fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv.trim() : undefined);
  const source = fromFile === undefined ? DATABASE_URL_ENV_VAR : `${path} databaseUrl`;

  if (candidate === undefined) {
    throw new ConfigError(
      path,
      `${path} names a local Mneia store but supplies no connection string, and ${DATABASE_URL_ENV_VAR} is unset.`,
      `Add a "databaseUrl" field to ${path}, or set ${DATABASE_URL_ENV_VAR} in the MCP client's server config. Use the direct Postgres connection string, not a pooled one.`,
    );
  }

  let protocol: string;
  try {
    protocol = new URL(candidate).protocol;
  } catch {
    throw new ConfigError(
      path,
      `${source} is not a URL, so it cannot be a Postgres connection string.`,
      `Set it to a postgres:// URL such as postgres://user:password@host:5432/mneia. The value is not echoed here because it carries a password.`,
    );
  }

  if (!POSTGRES_PROTOCOLS.has(protocol)) {
    throw new ConfigError(
      path,
      `${source} must use the postgres or postgresql scheme; received "${protocol.replace(':', '')}".`,
      'Set it to a postgres:// URL such as postgres://user:password@host:5432/mneia.',
    );
  }

  return { databaseUrl: candidate, source };
}

function resolveLocalPath(path: string, configured: string | undefined, fallback: string): string {
  if (configured === undefined) {
    return fallback;
  }
  return isAbsolute(configured) ? configured : resolve(join(path, '..'), configured);
}

async function loadLocalBinding(
  env: EnvLike,
  readTextFile: FileReader,
): Promise<LocalBinding | null> {
  const path = localConfigPath(env);
  const requested = env[LOCAL_CONFIG_PATH_ENV_VAR];
  const explicit = requested !== undefined && requested.trim().length > 0;

  let raw: string;
  try {
    raw = await readTextFile(path);
  } catch (cause) {
    if (isNotFound(cause)) {
      if (!explicit) {
        return null;
      }
      throw new ConfigError(
        LOCAL_CONFIG_PATH_ENV_VAR,
        `${LOCAL_CONFIG_PATH_ENV_VAR} points at ${path}, and no file exists there.`,
        `Write that file with databaseUrl, workspaceId and agentActorId, or unset ${LOCAL_CONFIG_PATH_ENV_VAR} to fall back to the hosted API.`,
      );
    }
    throw new ConfigError(
      path,
      `${path} could not be read: ${describeCause(cause)}.`,
      'Check the file permissions, or delete it to fall back to the hosted API.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new ConfigError(
      path,
      `${path} is not valid JSON: ${describeCause(cause)}.`,
      'Fix the JSON, or delete the file to fall back to the hosted API.',
    );
  }

  const result = localConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(
      path,
      `${path} is not a valid local Mneia binding — ${describeIssues(result.error)}.`,
      `Fix the field named above. The file must carry workspaceId and agentActorId as UUIDs; agentActorId must be an actor whose kind is "agent", never the human one, or every item this server writes is recorded as human-confirmed.`,
    );
  }

  const { databaseUrl, source } = resolveDatabaseUrl(path, env, result.data.databaseUrl);

  return {
    databaseUrl,
    databaseUrlSource: source,
    workspaceId: result.data.workspaceId,
    agentActorId: result.data.agentActorId,
    humanActorId: result.data.humanActorId ?? null,
    projectId: result.data.projectId ?? null,
    projectSlug: result.data.projectSlug ?? null,
    telemetryPath: resolveLocalPath(
      path,
      result.data.telemetryPath,
      homeConfigPath(env, EVENTS_FILE),
    ),
    reviewQueuePath: resolveLocalPath(
      path,
      result.data.reviewQueuePath,
      homeConfigPath(env, REVIEW_QUEUE_FILE),
    ),
    configPath: path,
  };
}

export async function loadServerConfig(
  options: LoadServerConfigOptions = {},
): Promise<ServerConfig> {
  const env = options.env ?? process.env;
  const cwd = resolve(options.cwd ?? process.cwd());
  const readTextFile = options.readTextFile ?? defaultReadTextFile;

  const telemetryEnabled = resolveTelemetryEnabled(env);
  const project = await loadProjectBinding(cwd, readTextFile);
  const local = await loadLocalBinding(env, readTextFile);

  if (local !== null) {
    return {
      mode: 'local',
      local,
      telemetryEnabled,
      project: project?.binding ?? null,
      cwd,
    };
  }

  const endpoint = resolveEndpoint(env, project?.endpoint);
  const token = await resolveToken(env, readTextFile);

  return {
    mode: 'hosted',
    token,
    endpoint,
    telemetryEnabled,
    project: project?.binding ?? null,
    cwd,
  };
}

export function describeConfigError(error: ConfigError): string {
  return `mneia-mcp cannot start: ${error.summary} ${error.remedy}`;
}
