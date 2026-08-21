import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, WORKSPACE_SETTING } from '../../packages/core/src/index.js';
import {
  audit,
  classify,
  HEALTHY,
  MISSING_OWNER,
  NO_IDENTIFIED_HUMAN,
  NON_OWNER_ONLY,
  readWorkspace,
  SEVERAL_OWNERS,
  UsageError,
} from '../../scripts/audit-workspace-membership.mjs';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const TENANT_ROLE = 'mne275_tenant';

const DRY = { apply: false, help: false, workspaces: [] as string[] };
const APPLY = { apply: true, help: false, workspaces: [] as string[] };

const HEALTHY_WS = '11111111-1111-4111-8111-111111111111';
const MISSING_WS = '22222222-2222-4222-8222-222222222222';
const NON_OWNER_WS = '33333333-3333-4333-8333-333333333333';
const NO_IDENTITY_WS = '44444444-4444-4444-8444-444444444444';

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

let schemaCounter = 0;

async function withSchema<T>(run: (client: Client, schema: string) => Promise<T>): Promise<T> {
  const schema = `mne275_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration' });
    await seed(client);
    return await run(client, schema);
  } finally {
    await client.query('RESET ROLE');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

const scope = (client: Client, workspaceId: string | null) =>
  client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId ?? '']);

async function workspace(client: Client, id: string, slug: string, minutesAgo: number) {
  await scope(client, id);
  await client.query(
    `INSERT INTO workspace (id, slug, display_name, created_at)
     VALUES ($1, $2, $2, now() - make_interval(mins => $3::int))`,
    [id, slug, minutesAgo],
  );
}

async function identifiedHuman(
  client: Client,
  workspaceId: string,
  subject: string,
  minutesAgo: number,
): Promise<string> {
  const { rows: identityRows } = await client.query(
    'INSERT INTO identity (id, subject) VALUES (gen_random_uuid(), $1) RETURNING id',
    [subject],
  );
  const identityId = identityRows[0]?.id as string;

  await client.query(
    `INSERT INTO actor (id, workspace_id, kind, display_name, external_ref, identity_id, created_at)
     VALUES (gen_random_uuid(), $1, 'human', $2, $2, $3, now() - make_interval(mins => $4::int))`,
    [workspaceId, subject, identityId, minutesAgo],
  );

  return identityId;
}

const anonymousHuman = (client: Client, workspaceId: string, name: string) =>
  client.query(
    `INSERT INTO actor (id, workspace_id, kind, display_name)
     VALUES (gen_random_uuid(), $1, 'human', $2)`,
    [workspaceId, name],
  );

const member = (client: Client, workspaceId: string, identityId: string, role: string) =>
  client.query(
    'INSERT INTO workspace_member (workspace_id, identity_id, role) VALUES ($1, $2, $3::workspace_role)',
    [workspaceId, identityId, role],
  );

async function seed(client: Client): Promise<void> {
  await workspace(client, HEALTHY_WS, 'healthy', 40);
  const owner = await identifiedHuman(client, HEALTHY_WS, 'user_healthy', 40);
  await member(client, HEALTHY_WS, owner, 'owner');

  await workspace(client, MISSING_WS, 'missing', 30);
  await identifiedHuman(client, MISSING_WS, 'user_missing_creator', 30);
  await identifiedHuman(client, MISSING_WS, 'user_missing_joiner', 5);

  await workspace(client, NON_OWNER_WS, 'non-owner', 20);
  const demoted = await identifiedHuman(client, NON_OWNER_WS, 'user_non_owner', 20);
  await member(client, NON_OWNER_WS, demoted, 'member');

  await workspace(client, NO_IDENTITY_WS, 'no-identity', 10);
  await anonymousHuman(client, NO_IDENTITY_WS, 'fixture human');

  await scope(client, null);
}

const ownerIdentities = async (client: Client, workspaceId: string): Promise<string[]> => {
  await scope(client, workspaceId);
  const { rows } = await client.query(
    "SELECT identity_id FROM workspace_member WHERE workspace_id = $1 AND role = 'owner' ORDER BY identity_id",
    [workspaceId],
  );
  await scope(client, null);
  return rows.map((row: { identity_id: string }) => row.identity_id);
};

const creatorIdentity = async (client: Client, workspaceId: string): Promise<string | null> => {
  const entry = await readWorkspace(client, workspaceId);
  return entry.creatorIdentityId;
};

describe.skipIf(connectionString === undefined)('MNE-275 workspace membership audit', () => {
  beforeAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
           CREATE ROLE ${TENANT_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS;
         END IF;
       END $$`,
    );
    await client.query(`GRANT ${TENANT_ROLE} TO CURRENT_USER`);
    await client.end();
  });

  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne275_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.query(`DROP ROLE IF EXISTS ${TENANT_ROLE}`);
    await client.end();
  });

  it('names exactly the three unhealthy workspaces and classifies each one', async () => {
    await withSchema(async (client) => {
      const verdicts = new Map<string, string>();

      for (const id of [HEALTHY_WS, MISSING_WS, NON_OWNER_WS, NO_IDENTITY_WS]) {
        verdicts.set(id, classify(await readWorkspace(client, id)));
      }

      expect(verdicts.get(HEALTHY_WS)).toBe(HEALTHY);
      expect(verdicts.get(MISSING_WS)).toBe(MISSING_OWNER);
      expect(verdicts.get(NON_OWNER_WS)).toBe(NON_OWNER_ONLY);
      expect(verdicts.get(NO_IDENTITY_WS)).toBe(NO_IDENTIFIED_HUMAN);
    });
  });

  it('reports two repairable and one undecidable, and writes nothing without --apply', async () => {
    await withSchema(async (client) => {
      const report = await audit(client, DRY);

      expect(report).toMatchObject({
        examined: 4,
        healthy: 1,
        repairable: 2,
        repaired: 0,
        undecidable: 1,
      });

      expect(await ownerIdentities(client, MISSING_WS)).toEqual([]);
      expect(await ownerIdentities(client, NON_OWNER_WS)).toEqual([]);
      expect(await ownerIdentities(client, NO_IDENTITY_WS)).toEqual([]);
      expect(await ownerIdentities(client, HEALTHY_WS)).toHaveLength(1);
    });
  });

  it('repairs exactly the repairable ones, picks the earliest human, and a second run is a no-op', async () => {
    await withSchema(async (client) => {
      const expectedCreator = await creatorIdentity(client, MISSING_WS);
      const expectedDemoted = await creatorIdentity(client, NON_OWNER_WS);

      const first = await audit(client, APPLY);

      expect(first).toMatchObject({ examined: 4, healthy: 1, repairable: 2, repaired: 2 });
      expect(await ownerIdentities(client, MISSING_WS)).toEqual([expectedCreator]);
      expect(await ownerIdentities(client, NON_OWNER_WS)).toEqual([expectedDemoted]);
      expect(await ownerIdentities(client, NO_IDENTITY_WS)).toEqual([]);

      const second = await audit(client, APPLY);

      expect(second).toMatchObject({ examined: 4, healthy: 3, repairable: 0, repaired: 0 });
      expect(classify(await readWorkspace(client, NO_IDENTITY_WS))).toBe(NO_IDENTIFIED_HUMAN);
    });
  });

  it('promotes the existing membership row rather than adding a second one', async () => {
    await withSchema(async (client) => {
      await audit(client, APPLY);

      await scope(client, NON_OWNER_WS);
      const { rows } = await client.query(
        'SELECT count(*)::int AS n FROM workspace_member WHERE workspace_id = $1',
        [NON_OWNER_WS],
      );
      await scope(client, null);

      expect(rows[0]?.n).toBe(1);
    });
  });

  it('leaves a workspace holding two owners alone, because choosing between them is a decision', async () => {
    await withSchema(async (client) => {
      const second = await identifiedHuman(client, HEALTHY_WS, 'user_healthy_second', 1);
      await scope(client, HEALTHY_WS);
      await member(client, HEALTHY_WS, second, 'owner');
      await scope(client, null);

      expect(classify(await readWorkspace(client, HEALTHY_WS))).toBe(SEVERAL_OWNERS);

      const report = await audit(client, APPLY);

      expect(report).toMatchObject({ examined: 4, healthy: 0, repairable: 2, undecidable: 2 });
      expect(await ownerIdentities(client, HEALTHY_WS)).toHaveLength(2);
    });
  });

  it('refuses to call an unscoped listing healthy when row-level security is doing the hiding', async () => {
    await withSchema(async (client, schema) => {
      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(`SET ROLE ${TENANT_ROLE}`);

      const unscoped = await client.query('SELECT id FROM workspace');
      expect(unscoped.rows).toEqual([]);

      await expect(audit(client, DRY)).rejects.toThrow(UsageError);
      await expect(audit(client, DRY)).rejects.toThrow(/not proof that there are zero workspaces/);
    });
  });

  it('audits and repairs a named workspace on a connection row-level security applies to', async () => {
    await withSchema(async (client, schema) => {
      const expectedCreator = await creatorIdentity(client, MISSING_WS);

      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${TENANT_ROLE}`);
      await client.query(
        `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "${schema}" TO ${TENANT_ROLE}`,
      );
      await client.query(`SET ROLE ${TENANT_ROLE}`);

      const report = await audit(client, {
        apply: true,
        help: false,
        workspaces: [MISSING_WS, HEALTHY_WS],
      });

      expect(report).toMatchObject({ examined: 2, healthy: 1, repairable: 1, repaired: 1 });
      expect(report.posture.bypassesRls).toBe(false);
      expect(await ownerIdentities(client, MISSING_WS)).toEqual([expectedCreator]);

      await client.query('RESET ROLE');
      expect(await ownerIdentities(client, NON_OWNER_WS)).toEqual([]);
    });
  });
});
