import { beforeEach, describe, expect, it } from 'vitest';
import type { MigrationDriver, SqlExecutor, SqlResult, SqlValue } from './driver.js';
import { BOOKKEEPING_TABLE, migrate, readAppliedMigrations } from './migrate.js';
import type { Migration } from './migrations/index.js';
import { MIGRATIONS } from './migrations/index.js';
import { checksumOf, MigrationError } from './plan.js';

interface StoredRow {
  version: number;
  name: string;
  checksum: string;
  applied_by: string | null;
}

class FakeDriver implements MigrationDriver {
  readonly statements: string[] = [];
  readonly lockLog: string[] = [];
  rows: StoredRow[] = [];
  bookkeepingExists = false;
  failOn: number | null = null;

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    const statement = sql.trim();

    if (statement.includes('pg_advisory_lock')) {
      this.lockLog.push('lock');
      return this.empty<TRow>();
    }
    if (statement.includes('pg_advisory_unlock')) {
      this.lockLog.push('unlock');
      return this.empty<TRow>();
    }

    this.statements.push(statement);

    if (statement.startsWith(`CREATE TABLE IF NOT EXISTS ${BOOKKEEPING_TABLE}`)) {
      this.bookkeepingExists = true;
      return this.empty<TRow>();
    }

    if (!this.bookkeepingExists && statement.includes(BOOKKEEPING_TABLE)) {
      throw new Error(`relation "${BOOKKEEPING_TABLE}" does not exist`);
    }

    if (statement.startsWith(`SELECT version, name, checksum FROM ${BOOKKEEPING_TABLE}`)) {
      const rows = [...this.rows].sort((a, b) => a.version - b.version);
      return { rows } as unknown as SqlResult<TRow>;
    }

    if (statement.startsWith(`INSERT INTO ${BOOKKEEPING_TABLE}`)) {
      this.rows.push({
        version: Number(params[0]),
        name: String(params[1]),
        checksum: String(params[2]),
        applied_by: params[3] === null ? null : String(params[3]),
      });
      return this.empty<TRow>();
    }

    if (this.failOn !== null && statement.includes(`-- migration ${this.failOn}`)) {
      throw new Error('syntax error at or near "OOPS"');
    }

    return this.empty<TRow>();
  }

  async transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T> {
    const snapshot = [...this.rows];
    this.statements.push('BEGIN');
    try {
      const result = await run(this);
      this.statements.push('COMMIT');
      return result;
    } catch (error) {
      this.rows = snapshot;
      this.statements.push('ROLLBACK');
      throw error;
    }
  }

  private empty<TRow>(): SqlResult<TRow> {
    return { rows: [] } as unknown as SqlResult<TRow>;
  }
}

const migration = (version: number): Migration => ({
  version,
  name: `m${version}`,
  sql: `CREATE TABLE t${version} (id INT); -- migration ${version}`,
});

async function refusal(run: () => Promise<unknown>): Promise<MigrationError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof MigrationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a MigrationError, but the run succeeded');
}

describe('migrate', () => {
  let driver: FakeDriver;

  beforeEach(() => {
    driver = new FakeDriver();
  });

  it('migrates an empty store and records what it applied', async () => {
    const migrations = [migration(1), migration(2)];

    const result = await migrate(driver, { migrations, appliedBy: 'test' });

    expect(result.applied.map((m) => m.version)).toEqual([1, 2]);
    expect(result.schemaVersion).toBe(2);
    expect(result.alreadyApplied).toBe(0);
    expect(await readAppliedMigrations(driver)).toEqual([
      { version: 1, name: 'm1', checksum: checksumOf(migrations[0]?.sql ?? '') },
      { version: 2, name: 'm2', checksum: checksumOf(migrations[1]?.sql ?? '') },
    ]);
  });

  it('commits each migration with its bookkeeping row in one transaction', async () => {
    await migrate(driver, { migrations: [migration(1)] });

    const begin = driver.statements.indexOf('BEGIN');
    const commit = driver.statements.indexOf('COMMIT');
    const ddl = driver.statements.findIndex((s) => s.includes('-- migration 1'));
    const insert = driver.statements.findIndex((s) =>
      s.startsWith(`INSERT INTO ${BOOKKEEPING_TABLE}`),
    );

    expect(begin).toBeLessThan(ddl);
    expect(ddl).toBeLessThan(insert);
    expect(insert).toBeLessThan(commit);
  });

  it('is a no-op on a second run', async () => {
    const migrations = [migration(1), migration(2)];
    await migrate(driver, { migrations });

    const second = await migrate(driver, { migrations });

    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toBe(2);
    expect(second.schemaVersion).toBe(2);
  });

  it('applies only what is missing', async () => {
    await migrate(driver, { migrations: [migration(1)] });

    const result = await migrate(driver, { migrations: [migration(1), migration(2)] });

    expect(result.applied.map((m) => m.version)).toEqual([2]);
  });

  it('writes nothing when it refuses a store newer than the binary', async () => {
    await migrate(driver, { migrations: [migration(1), migration(2)] });
    const statementsBefore = driver.statements.length;

    const error = await refusal(() => migrate(driver, { migrations: [migration(1)] }));

    expect(error.code).toBe('store_ahead_of_binary');
    expect(
      driver.statements.slice(statementsBefore).filter((s) => s.includes('-- migration')),
    ).toEqual([]);
    expect(driver.rows.map((row) => row.version)).toEqual([1, 2]);
  });

  it('rolls back a failing migration and leaves the store on the last good version', async () => {
    driver.failOn = 2;

    const error = await refusal(() =>
      migrate(driver, { migrations: [migration(1), migration(2), migration(3)] }),
    );

    expect(error.code).toBe('apply_failed');
    expect(error.message).toContain('remains at version 1');
    expect(error.cause).toBeInstanceOf(Error);
    expect(driver.rows.map((row) => row.version)).toEqual([1]);
    expect(driver.statements).toContain('ROLLBACK');
    expect(driver.statements.some((s) => s.includes('-- migration 3'))).toBe(false);
  });

  it('releases the advisory lock on success and on refusal', async () => {
    await migrate(driver, { migrations: [migration(2)] });
    expect(driver.lockLog).toEqual(['lock', 'unlock']);

    await refusal(() => migrate(driver, { migrations: [migration(1), migration(2)] }));
    expect(driver.lockLog).toEqual(['lock', 'unlock', 'lock', 'unlock']);
  });

  it('records who applied the migration', async () => {
    await migrate(driver, { migrations: [migration(1)], appliedBy: 'ci@github' });

    expect(driver.rows[0]?.applied_by).toBe('ci@github');
  });

  it('runs the shipped migration list from empty', async () => {
    const result = await migrate(driver);

    expect(result.applied.map((m) => m.version)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(result.schemaVersion).toBeGreaterThan(0);
  });
});
