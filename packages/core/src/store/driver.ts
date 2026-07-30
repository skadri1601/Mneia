export type SqlValue = string | number | boolean | Date | null;

export interface SqlResult<TRow> {
  readonly rows: readonly TRow[];
}

export interface SqlExecutor {
  execute<TRow = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlValue[],
  ): Promise<SqlResult<TRow>>;
}

export interface MigrationDriver extends SqlExecutor {
  transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}
