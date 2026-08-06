import type { PostgresConnectionSource, PostgresSession, SqlResult, SqlValue } from '@mneia/core';
import { Pool } from 'pg';

export const DEFAULT_MAX_CONNECTIONS = 4;
export const DEFAULT_APPLICATION_NAME = 'mneia-mcp';

export interface PoolQueryResult {
  readonly rows: readonly unknown[];
}

export interface PoolClientLike {
  query(sql: string, params?: readonly SqlValue[]): Promise<PoolQueryResult>;
  release(destroy?: boolean): void;
}

export interface PoolLike {
  connect(): Promise<PoolClientLike>;
  end(): Promise<void>;
}

export interface PoolConnectionSourceOptions {
  readonly databaseUrl: string;
  readonly maxConnections?: number | undefined;
  readonly applicationName?: string | undefined;
  readonly onIdleError?: ((error: Error) => void) | undefined;
  readonly createPool?: ((options: PoolConnectionSourceOptions) => PoolLike) | undefined;
}

function reportToStderr(error: Error): void {
  process.stderr.write(`mneia-mcp: idle Postgres connection failed: ${error.message}\n`);
}

function createPgPool(options: PoolConnectionSourceOptions): PoolLike {
  const pool = new Pool({
    connectionString: options.databaseUrl,
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    application_name: options.applicationName ?? DEFAULT_APPLICATION_NAME,
  });

  const onIdleError = options.onIdleError ?? reportToStderr;
  pool.on('error', onIdleError);

  return {
    async connect(): Promise<PoolClientLike> {
      const client = await pool.connect();
      return {
        async query(sql, params) {
          const result =
            params === undefined ? await client.query(sql) : await client.query(sql, [...params]);
          return { rows: result.rows };
        },
        release(destroy) {
          client.release(destroy);
        },
      };
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}

class PoolSession implements PostgresSession {
  constructor(private readonly client: PoolClientLike) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<SqlResult<TRow>> {
    const result = await this.client.query(sql, params);
    return { rows: result.rows as readonly TRow[] };
  }

  async release(): Promise<void> {
    this.client.release();
  }

  async discard(): Promise<void> {
    this.client.release(true);
  }
}

export class PoolConnectionSource implements PostgresConnectionSource {
  private pool: PoolLike | null = null;
  private readonly options: PoolConnectionSourceOptions;
  private readonly build: (options: PoolConnectionSourceOptions) => PoolLike;

  constructor(options: PoolConnectionSourceOptions) {
    this.options = options;
    this.build = options.createPool ?? createPgPool;
  }

  async acquire(): Promise<PostgresSession> {
    this.pool ??= this.build(this.options);
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
