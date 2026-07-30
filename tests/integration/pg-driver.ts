import type { Client } from 'pg';
import type {
  MigrationDriver,
  SqlExecutor,
  SqlResult,
  SqlValue,
} from '../../packages/core/src/index.js';

export class PgDriver implements MigrationDriver {
  constructor(private readonly client: Client) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    const result =
      params.length === 0
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);

    return { rows: result.rows as TRow[] };
  }

  async transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    await this.client.query('BEGIN');
    try {
      const result = await run(this);
      await this.client.query('COMMIT');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }
}
