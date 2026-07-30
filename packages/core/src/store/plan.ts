import { createHash } from 'node:crypto';
import type { AppliedMigration, Migration } from './migrations/index.js';

export type MigrationErrorCode =
  | 'invalid_version'
  | 'duplicate_version'
  | 'store_ahead_of_binary'
  | 'unknown_applied_migration'
  | 'checksum_mismatch'
  | 'out_of_order'
  | 'apply_failed';

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;

  constructor(code: MigrationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MigrationError';
    this.code = code;
  }
}

export interface MigrationPlan {
  readonly pending: readonly Migration[];
  readonly storeVersion: number;
  readonly targetVersion: number;
  readonly alreadyApplied: number;
}

const normalizeSql = (sql: string): string => sql.replace(/\r\n/g, '\n').trim();

export const checksumOf = (sql: string): string =>
  createHash('sha256').update(normalizeSql(sql), 'utf8').digest('hex');

const byVersion = <T extends { readonly version: number }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => a.version - b.version);

const highestVersion = (items: readonly { readonly version: number }[]): number =>
  items.reduce((max, item) => (item.version > max ? item.version : max), 0);

export function validateMigrationList(migrations: readonly Migration[]): void {
  const seen = new Set<number>();

  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new MigrationError(
        'invalid_version',
        `migration "${migration.name}" has version ${migration.version}; versions must be integers of 1 or greater`,
      );
    }
    if (seen.has(migration.version)) {
      throw new MigrationError(
        'duplicate_version',
        `two migrations share version ${migration.version}; every version must be unique and forward-only`,
      );
    }
    seen.add(migration.version);
  }
}

export function planMigrations(
  migrations: readonly Migration[],
  applied: readonly AppliedMigration[],
): MigrationPlan {
  validateMigrationList(migrations);

  const known = new Map(migrations.map((migration) => [migration.version, migration]));
  const targetVersion = highestVersion(migrations);
  const storeVersion = highestVersion(applied);

  for (const record of byVersion(applied)) {
    const migration = known.get(record.version);

    if (migration === undefined) {
      if (record.version > targetVersion) {
        throw new MigrationError(
          'store_ahead_of_binary',
          `store is at schema version ${record.version} but this build only knows up to ${targetVersion}; refusing to migrate. The store was migrated by a newer build of Mneia — deploy a build at schema version ${record.version} or higher rather than downgrading the store.`,
        );
      }
      throw new MigrationError(
        'unknown_applied_migration',
        `store has migration ${record.version} ("${record.name}") applied but this build does not define it; refusing to migrate. Migrations are forward-only and must never be deleted once shipped.`,
      );
    }

    const expected = checksumOf(migration.sql);
    if (record.checksum !== expected) {
      throw new MigrationError(
        'checksum_mismatch',
        `migration ${record.version} ("${migration.name}") has changed since it was applied; refusing to migrate. Migrations are forward-only — add a new migration instead of editing one that has already run.`,
      );
    }
  }

  const appliedVersions = new Set(applied.map((record) => record.version));
  const pending = byVersion(migrations).filter(
    (migration) => !appliedVersions.has(migration.version),
  );

  for (const migration of pending) {
    if (migration.version < storeVersion) {
      throw new MigrationError(
        'out_of_order',
        `migration ${migration.version} ("${migration.name}") is unapplied but the store is already at version ${storeVersion}; refusing to migrate. Renumber it above ${storeVersion} — applying it now would make the store's history depend on merge order.`,
      );
    }
  }

  return {
    pending,
    storeVersion,
    targetVersion,
    alreadyApplied: applied.length,
  };
}
