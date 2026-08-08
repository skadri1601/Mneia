import type { MigrationDriver, SqlExecutor } from './driver.js';
import type { AppliedMigration, Migration } from './migrations/index.js';
import { MIGRATIONS } from './migrations/index.js';
import { checksumOf, MigrationError, planMigrations } from './plan.js';

export const BOOKKEEPING_TABLE = 'mneia_schema_migration';

const ADVISORY_LOCK_KEY = 8090231;

const BOOKKEEPING_DDL = `
CREATE TABLE IF NOT EXISTS ${BOOKKEEPING_TABLE} (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  checksum    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by  TEXT
);
`;

export interface MigrateOptions {
  readonly migrations?: readonly Migration[];
  readonly appliedBy?: string | null;
}

export interface MigrateResult {
  readonly applied: readonly Migration[];
  readonly alreadyApplied: number;
  readonly schemaVersion: number;
}

interface AppliedRow {
  version: number | string;
  name: string;
  checksum: string;
}

export async function ensureBookkeepingTable(executor: SqlExecutor): Promise<void> {
  await executor.execute(BOOKKEEPING_DDL);
}

export async function readAppliedMigrations(
  executor: SqlExecutor,
): Promise<readonly AppliedMigration[]> {
  const result = await executor.execute<AppliedRow>(
    `SELECT version, name, checksum FROM ${BOOKKEEPING_TABLE} ORDER BY version`,
  );

  return result.rows.map((row) => ({
    version: Number(row.version),
    name: row.name,
    checksum: row.checksum,
  }));
}

export async function migrate(
  driver: MigrationDriver,
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const migrations = options.migrations ?? MIGRATIONS;
  const appliedBy = options.appliedBy ?? null;

  await driver.execute('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);

  try {
    await ensureBookkeepingTable(driver);

    const plan = planMigrations(migrations, await readAppliedMigrations(driver));
    const applied: Migration[] = [];
    let schemaVersion = plan.storeVersion;

    for (const migration of plan.pending) {
      try {
        await driver.transaction(async (tx) => {
          await tx.execute(migration.sql);
          await tx.execute(
            `INSERT INTO ${BOOKKEEPING_TABLE} (version, name, checksum, applied_by) VALUES ($1, $2, $3, $4)`,
            [migration.version, migration.name, checksumOf(migration.sql), appliedBy],
          );
        });
      } catch (cause) {
        throw new MigrationError(
          'apply_failed',
          `migration ${migration.version} ("${migration.name}") failed and was rolled back; the store remains at version ${schemaVersion}`,
          { cause },
        );
      }

      applied.push(migration);
      schemaVersion = migration.version;
    }

    return { applied, alreadyApplied: plan.alreadyApplied, schemaVersion };
  } finally {
    await driver.execute('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}
