import { describe, expect, it } from 'vitest';
import type { AppliedMigration, Migration } from './migrations/index.js';
import { checksumOf, MigrationError, planMigrations } from './plan.js';

const migration = (version: number, sql = `SELECT ${version};`): Migration => ({
  version,
  name: `m${version}`,
  sql,
});

const appliedFrom = (source: Migration): AppliedMigration => ({
  version: source.version,
  name: source.name,
  checksum: checksumOf(source.sql),
});

function refusal(run: () => unknown): MigrationError {
  try {
    run();
  } catch (error) {
    if (error instanceof MigrationError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a MigrationError, but the plan was produced');
}

describe('planMigrations', () => {
  it('plans every migration against an empty store', () => {
    const plan = planMigrations([migration(1), migration(2)], []);

    expect(plan.pending.map((m) => m.version)).toEqual([1, 2]);
    expect(plan.storeVersion).toBe(0);
    expect(plan.targetVersion).toBe(2);
    expect(plan.alreadyApplied).toBe(0);
  });

  it('orders pending migrations by version regardless of list order', () => {
    const plan = planMigrations([migration(3), migration(1), migration(2)], []);

    expect(plan.pending.map((m) => m.version)).toEqual([1, 2, 3]);
  });

  it('plans nothing when the store is already at the target version', () => {
    const migrations = [migration(1), migration(2)];
    const plan = planMigrations(migrations, migrations.map(appliedFrom));

    expect(plan.pending).toEqual([]);
    expect(plan.storeVersion).toBe(2);
    expect(plan.alreadyApplied).toBe(2);
  });

  it('plans only the unapplied tail of a partially migrated store', () => {
    const migrations = [migration(1), migration(2), migration(3)];
    const first = migrations[0];
    if (first === undefined) {
      throw new Error('fixture is empty');
    }

    const plan = planMigrations(migrations, [appliedFrom(first)]);

    expect(plan.pending.map((m) => m.version)).toEqual([2, 3]);
    expect(plan.storeVersion).toBe(1);
  });

  it('refuses a store migrated by a newer binary', () => {
    const error = refusal(() => planMigrations([migration(1)], [appliedFrom(migration(7))]));

    expect(error.code).toBe('store_ahead_of_binary');
    expect(error.message).toContain('store is at schema version 7');
    expect(error.message).toContain('only knows up to 1');
  });

  it('refuses when the store has applied a migration this build does not define', () => {
    const error = refusal(() =>
      planMigrations(
        [migration(1), migration(3)],
        [migration(1), migration(2), migration(3)].map(appliedFrom),
      ),
    );

    expect(error.code).toBe('unknown_applied_migration');
    expect(error.message).toContain('migration 2');
  });

  it('refuses a migration whose sql changed after it was applied', () => {
    const error = refusal(() =>
      planMigrations([migration(1, 'SELECT 1; -- edited')], [appliedFrom(migration(1))]),
    );

    expect(error.code).toBe('checksum_mismatch');
    expect(error.message).toContain('has changed since it was applied');
  });

  it('refuses a pending migration numbered behind the store version', () => {
    const error = refusal(() =>
      planMigrations([migration(1), migration(2)], [appliedFrom(migration(2))]),
    );

    expect(error.code).toBe('out_of_order');
    expect(error.message).toContain('already at version 2');
  });

  it('refuses two migrations that share a version', () => {
    const error = refusal(() => planMigrations([migration(1), migration(1)], []));

    expect(error.code).toBe('duplicate_version');
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses version %s', (version) => {
    expect(refusal(() => planMigrations([migration(version)], [])).code).toBe('invalid_version');
  });
});

describe('checksumOf', () => {
  it('ignores line-ending and surrounding-whitespace differences', () => {
    expect(checksumOf('CREATE TABLE a ();\r\nCREATE TABLE b ();')).toBe(
      checksumOf('\n  CREATE TABLE a ();\nCREATE TABLE b ();  \n'),
    );
  });

  it('changes when the statements change', () => {
    expect(checksumOf('CREATE TABLE a ();')).not.toBe(checksumOf('CREATE TABLE b ();'));
  });
});
