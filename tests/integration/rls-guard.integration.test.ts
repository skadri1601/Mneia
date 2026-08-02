import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WORKSPACE_SETTING, migrate } from '../../packages/core/src/index.js';
import {
  RlsGuardError,
  assertConnectionEnforcesRls,
  inspectRlsPosture,
} from '../../packages/core/src/store/rls-guard.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const TENANT_ROLE = 'mne186_tenant';
const MEMBER_ROLE = 'mne186_member';
const GRANTOR_ROLE = 'mne186_grantor';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

const createRole = async (client: Client, name: string, attributes: string): Promise<void> => {
  await client.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${name}') THEN
         CREATE ROLE ${name} NOLOGIN ${attributes};
       END IF;
     END $$`,
  );
};

const dropSchemas = async (client: Client): Promise<void> => {
  await client.query(
    `DO $$
     DECLARE s TEXT;
     BEGIN
       FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne186_%'
       LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
       END LOOP;
     END $$`,
  );
};

let schemaCounter = 0;

async function withSchema<T>(run: (client: Client, schema: string) => Promise<T>): Promise<T> {
  const schema = `mne186_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration' });
    return await run(client, schema);
  } finally {
    await client.query('RESET ROLE');
    await client.query(`ALTER ROLE ${TENANT_ROLE} NOBYPASSRLS`);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function refusal(run: () => Promise<unknown>): Promise<RlsGuardError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RlsGuardError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an RlsGuardError, but the guard allowed the connection');
}

describe.skipIf(connectionString === undefined)('rls guard against Postgres', () => {
  beforeAll(async () => {
    const client = await connect();
    await createRole(client, GRANTOR_ROLE, 'BYPASSRLS');
    await createRole(client, TENANT_ROLE, 'NOBYPASSRLS NOSUPERUSER');
    await createRole(client, MEMBER_ROLE, 'NOBYPASSRLS NOSUPERUSER');
    await client.query(`GRANT ${GRANTOR_ROLE} TO ${MEMBER_ROLE}`);
    await client.query(`GRANT ${TENANT_ROLE}, ${MEMBER_ROLE} TO CURRENT_USER`);
    await client.end();
  });

  afterAll(async () => {
    const client = await connect();
    await dropSchemas(client);
    for (const role of [TENANT_ROLE, MEMBER_ROLE, GRANTOR_ROLE]) {
      await client.query(`DROP ROLE IF EXISTS ${role}`);
    }
    await client.end();
  });

  it('admits a restricted role and refuses the same role once it holds BYPASSRLS', async () => {
    const client = await connect();
    const driver = new PgDriver(client);

    try {
      await client.query(`SET ROLE ${TENANT_ROLE}`);

      const restricted = await inspectRlsPosture(driver);
      expect(restricted.role).toBe(TENANT_ROLE);
      expect(restricted.isSuperuser).toBe(false);
      expect(restricted.bypassesRls).toBe(false);
      expect(restricted.viaRoles).toEqual([]);
      await expect(assertConnectionEnforcesRls(driver)).resolves.toBeUndefined();

      await client.query('RESET ROLE');
      await client.query(`ALTER ROLE ${TENANT_ROLE} BYPASSRLS`);
      await client.query(`SET ROLE ${TENANT_ROLE}`);

      const privileged = await inspectRlsPosture(driver);
      expect(privileged.bypassesRls).toBe(true);
      expect(privileged.viaRoles).toContain(TENANT_ROLE);

      const error = await refusal(() => assertConnectionEnforcesRls(driver));
      expect(error.code).toBe('bypasses_rls');
      expect(error.message).toContain(TENANT_ROLE);
      expect(error.message).toContain('NOBYPASSRLS');
    } finally {
      await client.query('RESET ROLE');
      await client.query(`ALTER ROLE ${TENANT_ROLE} NOBYPASSRLS`);
      await client.end();
    }
  });

  it('refuses a role that holds no attribute but is a member of one that does', async () => {
    const client = await connect();
    const driver = new PgDriver(client);

    try {
      await client.query(`SET ROLE ${MEMBER_ROLE}`);

      const own = await client.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      expect(own.rows[0]?.rolsuper).toBe(false);
      expect(own.rows[0]?.rolbypassrls).toBe(false);

      const guc = await client.query("SELECT current_setting('is_superuser') AS v");
      expect(guc.rows[0]?.v).toBe('off');

      const posture = await inspectRlsPosture(driver);
      expect(posture.role).toBe(MEMBER_ROLE);
      expect(posture.bypassesRls).toBe(true);
      expect(posture.viaRoles).toContain(GRANTOR_ROLE);

      const error = await refusal(() => assertConnectionEnforcesRls(driver));
      expect(error.code).toBe('bypasses_rls');
      expect(error.message).toContain(`REVOKE "${GRANTOR_ROLE}" FROM "${MEMBER_ROLE}"`);
    } finally {
      await client.query('RESET ROLE');
      await client.end();
    }
  });

  it('refuses exactly the connections on which workspace isolation stops applying', async () => {
    await withSchema(async (client, schema) => {
      const driver = new PgDriver(client);

      for (const [id, slug] of [
        [WS_A, 'acme'],
        [WS_B, 'globex'],
      ]) {
        await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, id]);
        await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
          id,
          slug,
        ]);
        await client.query(
          'INSERT INTO team (id, workspace_id, slug, display_name) VALUES (gen_random_uuid(), $1, $2, $2)',
          [id, `${slug}-eng`],
        );
      }

      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${TENANT_ROLE}`);

      await client.query(`SET ROLE ${TENANT_ROLE}`);
      await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS_A]);

      await expect(assertConnectionEnforcesRls(driver)).resolves.toBeUndefined();
      const isolated = await client.query('SELECT workspace_id FROM team');
      expect(isolated.rows).toHaveLength(1);
      expect(isolated.rows[0]?.workspace_id).toBe(WS_A);

      await client.query('RESET ROLE');
      await client.query(`ALTER ROLE ${TENANT_ROLE} BYPASSRLS`);
      await client.query(`SET ROLE ${TENANT_ROLE}`);
      await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS_A]);

      const error = await refusal(() => assertConnectionEnforcesRls(driver));
      expect(error.code).toBe('bypasses_rls');

      const leaked = await client.query('SELECT workspace_id FROM team');
      expect(leaked.rows).toHaveLength(2);
    });
  });
});
