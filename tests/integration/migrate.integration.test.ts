import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Migration } from '../../packages/core/src/index.js';
import {
  BOOKKEEPING_TABLE,
  MIGRATIONS,
  MigrationError,
  migrate,
  readAppliedMigrations,
} from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

let schemaCounter = 0;

async function withSchema<T>(run: (driver: PgDriver, client: Client) => Promise<T>): Promise<T> {
  const schema = `mne40_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    return await run(new PgDriver(client), client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

const tableExists = async (client: Client, name: string): Promise<boolean> => {
  const result = await client.query('SELECT to_regclass($1) AS reg', [name]);
  return result.rows[0]?.reg !== null;
};

describe.skipIf(connectionString === undefined)('migrate against Postgres', () => {
  beforeAll(async () => {
    const client = await connect();
    await client.query('SELECT 1');
    await client.end();
  });

  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne40_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('runs the shipped migrations from empty', async () => {
    await withSchema(async (driver, client) => {
      const result = await migrate(driver, { appliedBy: 'integration' });

      expect(result.applied.map((m) => m.version)).toEqual(MIGRATIONS.map((m) => m.version));
      expect(await tableExists(client, BOOKKEEPING_TABLE)).toBe(true);

      const extensions = await client.query(
        "SELECT extname FROM pg_extension WHERE extname IN ('vector', 'pgcrypto')",
      );
      expect(extensions.rows.map((row) => row.extname).sort()).toEqual(['pgcrypto', 'vector']);
    });
  });

  it('is a no-op on a second run', async () => {
    await withSchema(async (driver) => {
      await migrate(driver);
      const second = await migrate(driver);

      expect(second.applied).toEqual([]);
      expect(second.alreadyApplied).toBe(MIGRATIONS.length);
    });
  });

  it('refuses a store migrated by a newer binary without writing', async () => {
    await withSchema(async (driver) => {
      const ahead: Migration = {
        version: 9001,
        name: 'from-the-future',
        sql: 'CREATE TABLE future_table (id INT);',
      };
      await migrate(driver, { migrations: [...MIGRATIONS, ahead] });

      const error = await migrate(driver, { migrations: MIGRATIONS }).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).code).toBe('store_ahead_of_binary');
      expect((await readAppliedMigrations(driver)).map((m) => m.version)).toContain(9001);
    });
  });

  it('rolls back a failing migration entirely', async () => {
    await withSchema(async (driver, client) => {
      const broken: Migration = {
        version: 9002,
        name: 'creates-then-fails',
        sql: 'CREATE TABLE rollback_probe (id INT); SELECT this_function_does_not_exist();',
      };

      const error = await migrate(driver, { migrations: [...MIGRATIONS, broken] }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).code).toBe('apply_failed');
      expect(await tableExists(client, 'rollback_probe')).toBe(false);
      expect((await readAppliedMigrations(driver)).map((m) => m.version)).not.toContain(9002);
    });
  });

  it('serializes concurrent runners so each migration applies once', async () => {
    await withSchema(async (_driver, client) => {
      const schema = (await client.query('SELECT current_schema() AS name')).rows[0]?.name;
      const second = await connect();
      await second.query(`SET search_path TO "${schema}", public`);

      try {
        await Promise.all([migrate(new PgDriver(client)), migrate(new PgDriver(second))]);

        const rows = await client.query(
          `SELECT version, count(*) AS n FROM ${BOOKKEEPING_TABLE} GROUP BY version`,
        );
        expect(rows.rows.every((row) => Number(row.n) === 1)).toBe(true);
        expect(rows.rows).toHaveLength(MIGRATIONS.length);
      } finally {
        await second.end();
      }
    });
  });
});
