import 'server-only';

import type { PostgresConnectionSource, PostgresSession, SqlResult, SqlValue } from '@mneia/core';
import { Pool } from 'pg';

export interface DatabaseQueryResult {
  readonly rows: readonly unknown[];
}

export interface DatabaseClient {
  query(sql: string, params?: readonly SqlValue[]): Promise<DatabaseQueryResult>;
  release(destroy?: boolean): void;
}

export interface DatabasePool {
  connect(): Promise<DatabaseClient>;
  end(): Promise<void>;
}

export interface LazyPostgresConnectionSourceOptions {
  readonly readDatabaseUrl?: () => string | undefined;
  readonly createPool?: (databaseUrl: string) => DatabasePool;
}

export class DatabaseConfigurationError extends Error {
  constructor() {
    super('DATABASE_URL must be set before acquiring a Postgres connection');
    this.name = 'DatabaseConfigurationError';
  }
}

const createPgPool = (databaseUrl: string): DatabasePool => {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async connect(): Promise<DatabaseClient> {
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
};

class PoolSession implements PostgresSession {
  constructor(private readonly client: DatabaseClient) {}

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

export class LazyPostgresConnectionSource implements PostgresConnectionSource {
  private pool: DatabasePool | undefined;
  private readonly readDatabaseUrl: () => string | undefined;
  private readonly createPool: (databaseUrl: string) => DatabasePool;

  constructor(options: LazyPostgresConnectionSourceOptions = {}) {
    this.readDatabaseUrl = options.readDatabaseUrl ?? (() => process.env.DATABASE_URL);
    this.createPool = options.createPool ?? createPgPool;
  }

  async acquire(): Promise<PostgresSession> {
    const databaseUrl = this.readDatabaseUrl();
    if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
      throw new DatabaseConfigurationError();
    }

    this.pool ??= this.createPool(databaseUrl);
    return new PoolSession(await this.pool.connect());
  }

  async close(): Promise<void> {
    const pool = this.pool;
    if (pool === undefined) return;

    this.pool = undefined;
    await pool.end();
  }
}

export const database = new LazyPostgresConnectionSource();
