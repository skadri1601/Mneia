import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_ENTITY_TABLES, WORKSPACE_SETTING, migrate } from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const TENANT_ROLE = 'mne41_tenant';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

const setWorkspace = async (client: Client, id: string): Promise<void> => {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, id]);
};

let schemaCounter = 0;

async function withSchema<T>(run: (client: Client, schema: string) => Promise<T>): Promise<T> {
  const schema = `mne41_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration' });
    return await run(client, schema);
  } finally {
    await client.query('RESET ROLE');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function seedTwoWorkspaces(client: Client): Promise<void> {
  for (const [id, slug] of [
    [WS_A, 'acme'],
    [WS_B, 'globex'],
  ]) {
    await setWorkspace(client, id);
    await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $3)', [
      id,
      slug,
      slug,
    ]);
  }
}

describe.skipIf(connectionString === undefined)('core entity schema', () => {
  beforeAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
           CREATE ROLE ${TENANT_ROLE} NOLOGIN;
         END IF;
       END $$`,
    );
    await client.end();
  });

  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne41_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('creates all six core tables', async () => {
    await withSchema(async (client, schema) => {
      const result = await client.query(
        'SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename',
        [schema],
      );
      const tables = result.rows.map((row) => row.tablename as string);

      for (const table of CORE_ENTITY_TABLES) {
        expect(tables).toContain(table);
      }
    });
  });

  it('lets one workspace hold multiple teams each owning multiple projects', async () => {
    await withSchema(async (client) => {
      await seedTwoWorkspaces(client);
      await setWorkspace(client, WS_A);

      for (const [team, fn] of [
        ['backend', 'engineering'],
        ['revenue', 'sales'],
      ]) {
        await client.query(
          'INSERT INTO team (id, workspace_id, slug, display_name, function) VALUES (gen_random_uuid(), $1, $2, $3, $4::team_function)',
          [WS_A, team, team, fn],
        );
      }

      const teams = await client.query('SELECT id, slug FROM team ORDER BY slug');
      expect(teams.rows).toHaveLength(2);

      for (const row of teams.rows) {
        for (const suffix of ['one', 'two']) {
          await client.query(
            'INSERT INTO project (id, workspace_id, team_id, slug) VALUES (gen_random_uuid(), $1, $2, $3)',
            [WS_A, row.id, `${row.slug}-${suffix}`],
          );
        }
      }

      const perTeam = await client.query(
        'SELECT team_id, count(*)::int AS n FROM project GROUP BY team_id',
      );
      expect(perTeam.rows).toHaveLength(2);
      expect(perTeam.rows.every((row) => row.n === 2)).toBe(true);
    });
  });

  it('rejects a project pointing at a team in another workspace', async () => {
    await withSchema(async (client) => {
      await seedTwoWorkspaces(client);

      await setWorkspace(client, WS_B);
      const team = await client.query(
        'INSERT INTO team (id, workspace_id, slug, display_name) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id',
        [WS_B, 'globex-eng', 'Globex Engineering'],
      );
      const foreignTeamId = team.rows[0]?.id as string;

      await setWorkspace(client, WS_A);
      const error = await client
        .query(
          'INSERT INTO project (id, workspace_id, team_id, slug) VALUES (gen_random_uuid(), $1, $2, $3)',
          [WS_A, foreignTeamId, 'stolen'],
        )
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      expect((error as { code?: string }).code).toBe('23503');
    });
  });

  it('hides another workspace rows from a hand-written query with no filter', async () => {
    await withSchema(async (client, schema) => {
      await seedTwoWorkspaces(client);

      await setWorkspace(client, WS_A);
      await client.query(
        'INSERT INTO team (id, workspace_id, slug, display_name) VALUES (gen_random_uuid(), $1, $2, $3)',
        [WS_A, 'acme-eng', 'Acme Engineering'],
      );
      await setWorkspace(client, WS_B);
      await client.query(
        'INSERT INTO team (id, workspace_id, slug, display_name) VALUES (gen_random_uuid(), $1, $2, $3)',
        [WS_B, 'globex-eng', 'Globex Engineering'],
      );

      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(`SET ROLE ${TENANT_ROLE}`);

      await setWorkspace(client, WS_A);
      const leaked = await client.query('SELECT workspace_id, slug FROM team');

      expect(leaked.rows).toHaveLength(1);
      expect(leaked.rows[0]?.workspace_id).toBe(WS_A);

      await client.query('RESET ROLE');
    });
  });

  it('is bypassed by a superuser even with FORCE, which is why the app must not connect as one', async () => {
    await withSchema(async (client) => {
      await seedTwoWorkspaces(client);

      for (const [id, slug] of [
        [WS_A, 'acme-eng'],
        [WS_B, 'globex-eng'],
      ]) {
        await setWorkspace(client, id);
        await client.query(
          'INSERT INTO team (id, workspace_id, slug, display_name) VALUES (gen_random_uuid(), $1, $2, $2)',
          [id, slug],
        );
      }

      const isSuperuser = await client.query("SELECT current_setting('is_superuser') AS v");
      expect(isSuperuser.rows[0]?.v).toBe('on');

      await setWorkspace(client, WS_A);
      const rows = await client.query('SELECT workspace_id FROM team');

      expect(rows.rows).toHaveLength(2);
    });
  });

  it('returns nothing when the workspace setting is unset', async () => {
    await withSchema(async (client, schema) => {
      await seedTwoWorkspaces(client);
      await setWorkspace(client, WS_A);
      await client.query(
        'INSERT INTO team (id, workspace_id, slug, display_name) VALUES (gen_random_uuid(), $1, $2, $3)',
        [WS_A, 'acme-eng', 'Acme Engineering'],
      );

      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(`SET ROLE ${TENANT_ROLE}`);
      await setWorkspace(client, '');

      const rows = await client.query('SELECT slug FROM team');
      expect(rows.rows).toHaveLength(0);

      await client.query('RESET ROLE');
    });
  });
});
