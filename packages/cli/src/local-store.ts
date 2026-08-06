import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { PostgresConnectionSource, PostgresSession, ScopedStore, SqlValue } from '@mneia/core';
import { PostgresStoreAdapter } from '@mneia/core';
import { Pool } from 'pg';
import { z } from 'zod';
import { CliError } from './command.js';

export const LOCAL_CONFIG_FILE = 'local.json';
export const LOCAL_CONFIG_ENV_VAR = 'MNEIA_LOCAL_CONFIG';
export const DATABASE_URL_ENV_VAR = 'DATABASE_URL';

const MAX_CONNECTIONS = 2;

const localBindingSchema = z.object({
  databaseUrl: z.string().min(1).optional(),
  workspaceId: z.string().uuid(),
  humanActorId: z.string().uuid(),
  agentActorId: z.string().uuid().optional(),
  projectId: z.string().uuid().nullable().optional(),
  projectSlug: z.string().min(1).nullable().optional(),
});

export interface LocalBinding {
  readonly databaseUrl: string;
  readonly workspaceId: string;
  readonly humanActorId: string;
  readonly projectId: string | null;
  readonly projectSlug: string | null;
  readonly configPath: string;
}

export function localConfigPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env[LOCAL_CONFIG_ENV_VAR];
  if (override !== undefined && override.length > 0 && isAbsolute(override)) {
    return override;
  }
  return join(homedir(), '.mneia', LOCAL_CONFIG_FILE);
}

export async function loadLocalBinding(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LocalBinding | null> {
  const path = localConfigPath(env);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT') {
      return null;
    }
    throw new CliError(
      'failed',
      `could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      `check the file permissions on ${path}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CliError(
      'not_configured',
      `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      'fix the JSON, or delete the file and run pnpm bootstrap:local --apply again',
    );
  }

  const result = localBindingSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new CliError(
      'not_configured',
      `${path} is not a valid Mneia local binding: ${detail}`,
      'run pnpm bootstrap:local --apply to write a correct one',
    );
  }

  const databaseUrl = result.data.databaseUrl ?? env[DATABASE_URL_ENV_VAR];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new CliError(
      'not_configured',
      `${path} has no databaseUrl and ${DATABASE_URL_ENV_VAR} is unset, so there is no store to read`,
      `add a databaseUrl field to ${path}, or set ${DATABASE_URL_ENV_VAR}`,
    );
  }

  return {
    databaseUrl,
    workspaceId: result.data.workspaceId,
    humanActorId: result.data.humanActorId,
    projectId: result.data.projectId ?? null,
    projectSlug: result.data.projectSlug ?? null,
    configPath: path,
  };
}

export function requireLocalBinding(binding: LocalBinding | null, command: string): LocalBinding {
  if (binding !== null) {
    return binding;
  }
  throw new CliError(
    'not_configured',
    `mneia ${command} has no store to read: ${localConfigPath()} does not exist`,
    'run pnpm bootstrap:local --apply to create a workspace and write that file',
  );
}

interface PoolClientLike {
  query(sql: string, params?: readonly SqlValue[]): Promise<{ rows: readonly unknown[] }>;
  release(destroy?: boolean): void;
}

class PoolSession implements PostgresSession {
  constructor(private readonly client: PoolClientLike) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<{ rows: readonly TRow[] }> {
    const result =
      params === undefined
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);
    return { rows: result.rows as readonly TRow[] };
  }

  async release(): Promise<void> {
    this.client.release();
  }

  async discard(): Promise<void> {
    this.client.release(true);
  }
}

class CliConnectionSource implements PostgresConnectionSource {
  private pool: Pool | null = null;

  constructor(private readonly databaseUrl: string) {}

  async acquire(): Promise<PostgresSession> {
    this.pool ??= new Pool({
      connectionString: this.databaseUrl,
      max: MAX_CONNECTIONS,
      application_name: 'mneia-cli',
    });
    this.pool.on('error', (error) => {
      process.stderr.write(`mneia: idle Postgres connection failed: ${error.message}\n`);
    });
    return new PoolSession(await this.pool.connect());
  }

  async close(): Promise<void> {
    const pool = this.pool;
    if (pool === null) {
      return;
    }
    this.pool = null;
    await pool.end();
  }
}

export function describeDatabaseTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.host}${url.pathname}`;
  } catch {
    return 'the configured database';
  }
}

export async function withLocalStore<T>(
  binding: LocalBinding,
  run: (store: ScopedStore) => Promise<T>,
): Promise<T> {
  const adapter = new PostgresStoreAdapter(new CliConnectionSource(binding.databaseUrl));
  try {
    return await adapter.withScope(
      { workspaceId: binding.workspaceId, actorId: binding.humanActorId },
      run,
    );
  } catch (cause) {
    if (cause instanceof CliError) {
      throw cause;
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new CliError(
      'network',
      `the Mneia store at ${describeDatabaseTarget(binding.databaseUrl)} could not be read: ${detail}`,
      `check that the database is running and that databaseUrl in ${binding.configPath} is correct — this build reads Postgres directly, so no token is involved`,
    );
  } finally {
    await adapter.close();
  }
}
