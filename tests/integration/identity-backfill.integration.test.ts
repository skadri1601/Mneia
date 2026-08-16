import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

import { migrate, MIGRATIONS } from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;
const schemaPrefix = `mne126_backfill_${process.pid}_${Date.now()}`;

const BEFORE_BACKFILL = MIGRATIONS.filter(({ version }) => version < 30);

const WORKSPACE_SOLO = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_TEAM = '22222222-2222-4222-8222-222222222222';
const TEAM_SOLO = '33333333-3333-4333-8333-333333333333';
const TEAM_TEAM = '44444444-4444-4444-8444-444444444444';
const ACTOR_OWNER = '55555555-5555-4555-8555-555555555555';
const ACTOR_FOUNDER = '66666666-6666-4666-8666-666666666666';
const ACTOR_JOINER = '77777777-7777-4777-8777-777777777777';
const ACTOR_AGENT = '88888888-8888-4888-8888-888888888888';
const ACTOR_FIXTURE = '99999999-9999-4999-8999-999999999999';

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

let schemaCounter = 0;

async function withLegacySchema<T>(run: (admin: Client) => Promise<T>): Promise<T> {
  const schema = `${schemaPrefix}_${++schemaCounter}`;
  const admin = await connect();
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(admin), {
      appliedBy: 'integration',
      migrations: BEFORE_BACKFILL,
    });
    return await run(admin);
  } finally {
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

async function seedLegacyAccounts(admin: Client): Promise<void> {
  await admin.query(
    `INSERT INTO workspace (id, slug, display_name, plan) VALUES
       ($1, 'solo-legacy', 'Solo Legacy', 'solo'),
       ($2, 'team-legacy', 'Team Legacy', 'team')`,
    [WORKSPACE_SOLO, WORKSPACE_TEAM],
  );
  await admin.query(
    `INSERT INTO team (id, workspace_id, slug, display_name, function) VALUES
       ($1, $2, 'default', 'Default', 'engineering'),
       ($3, $4, 'default', 'Default', 'engineering')`,
    [TEAM_SOLO, WORKSPACE_SOLO, TEAM_TEAM, WORKSPACE_TEAM],
  );

  await admin.query(
    `INSERT INTO actor (id, workspace_id, kind, display_name, external_ref, created_at) VALUES
       ($1, $2, 'human', 'Solo Owner',  'clerk_owner',   now() - interval '3 days'),
       ($3, $4, 'human', 'Team Founder','clerk_founder', now() - interval '2 days'),
       ($5, $4, 'human', 'Team Joiner', 'clerk_owner',   now() - interval '1 day'),
       ($6, $2, 'agent', 'Claude Code', 'claude-code@sonnet', now()),
       ($7, $2, 'human', 'Fixture Human', NULL, now())`,
    [
      ACTOR_OWNER,
      WORKSPACE_SOLO,
      ACTOR_FOUNDER,
      WORKSPACE_TEAM,
      ACTOR_JOINER,
      ACTOR_AGENT,
      ACTOR_FIXTURE,
    ],
  );

  await admin.query(
    `INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES
       ($1, $2, $3, 'lead'),
       ($4, $5, $6, 'lead'),
       ($4, $5, $7, 'member')`,
    [
      WORKSPACE_SOLO,
      TEAM_SOLO,
      ACTOR_OWNER,
      WORKSPACE_TEAM,
      TEAM_TEAM,
      ACTOR_FOUNDER,
      ACTOR_JOINER,
    ],
  );
}

const applyBackfill = (admin: Client) => migrate(new PgDriver(admin), { appliedBy: 'integration' });

describe.skipIf(connectionString === undefined)('migration 0030 identity backfill', () => {
  afterAll(async () => {
    const admin = await connect();
    await admin.query(
      `DO $$ DECLARE schema_name TEXT; BEGIN
         FOR schema_name IN SELECT nspname FROM pg_namespace WHERE starts_with(nspname, '${schemaPrefix}')
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name); END LOOP; END $$`,
    );
    await admin.end();
  });

  it('leaves the pre-0030 schema with exactly the gap this migration exists to close', async () => {
    await withLegacySchema(async (admin) => {
      await seedLegacyAccounts(admin);

      const unlinked = await admin.query(
        `SELECT count(*)::int AS n FROM actor
          WHERE kind = 'human' AND identity_id IS NULL AND external_ref IS NOT NULL`,
      );
      const members = await admin.query('SELECT count(*)::int AS n FROM workspace_member');
      const identities = await admin.query('SELECT count(*)::int AS n FROM identity');

      expect(unlinked.rows[0]?.n).toBe(3);
      expect(members.rows[0]?.n).toBe(0);
      expect(identities.rows[0]?.n).toBe(0);
    });
  });

  it('gives every signed-in human an identity and its workspace a membership row', async () => {
    await withLegacySchema(async (admin) => {
      await seedLegacyAccounts(admin);
      await applyBackfill(admin);

      const subjects = await admin.query('SELECT subject FROM identity ORDER BY subject');
      expect(subjects.rows.map((row) => row.subject)).toEqual(['clerk_founder', 'clerk_owner']);

      const linked = await admin.query(
        `SELECT a.id, i.subject FROM actor a JOIN identity i ON i.id = a.identity_id
          ORDER BY a.created_at`,
      );
      expect(linked.rows).toEqual([
        { id: ACTOR_OWNER, subject: 'clerk_owner' },
        { id: ACTOR_FOUNDER, subject: 'clerk_founder' },
        { id: ACTOR_JOINER, subject: 'clerk_owner' },
      ]);

      const members = await admin.query(
        `SELECT m.workspace_id, i.subject, m.role
           FROM workspace_member m JOIN identity i ON i.id = m.identity_id
          ORDER BY m.workspace_id, i.subject`,
      );
      expect(members.rows).toEqual([
        { workspace_id: WORKSPACE_SOLO, subject: 'clerk_owner', role: 'owner' },
        { workspace_id: WORKSPACE_TEAM, subject: 'clerk_founder', role: 'owner' },
        { workspace_id: WORKSPACE_TEAM, subject: 'clerk_owner', role: 'member' },
      ]);
    });
  });

  it('gives one person one identity across two workspaces', async () => {
    await withLegacySchema(async (admin) => {
      await seedLegacyAccounts(admin);
      await applyBackfill(admin);

      const shared = await admin.query(
        `SELECT count(DISTINCT identity_id)::int AS identities, count(*)::int AS actors
           FROM actor WHERE external_ref = 'clerk_owner'`,
      );
      expect(shared.rows[0]).toEqual({ identities: 1, actors: 2 });
    });
  });

  it('never touches an agent actor or a fixture human with no external_ref', async () => {
    await withLegacySchema(async (admin) => {
      await seedLegacyAccounts(admin);
      await applyBackfill(admin);

      const untouched = await admin.query(
        'SELECT id FROM actor WHERE identity_id IS NULL ORDER BY id',
      );
      expect(untouched.rows.map((row) => row.id)).toEqual([ACTOR_AGENT, ACTOR_FIXTURE]);
    });
  });

  it('is safe to run against a store that already has identities', async () => {
    await withLegacySchema(async (admin) => {
      await seedLegacyAccounts(admin);
      await applyBackfill(admin);

      const before = await admin.query(
        'SELECT (SELECT count(*) FROM identity) AS i, (SELECT count(*) FROM workspace_member) AS m',
      );
      await migrate(new PgDriver(admin), { appliedBy: 'integration' });
      const after = await admin.query(
        'SELECT (SELECT count(*) FROM identity) AS i, (SELECT count(*) FROM workspace_member) AS m',
      );

      expect(after.rows[0]).toEqual(before.rows[0]);
    });
  });

  it('refuses a new signed-in human actor that carries no identity', async () => {
    await withLegacySchema(async (admin) => {
      await seedLegacyAccounts(admin);
      await applyBackfill(admin);

      await expect(
        admin.query(
          `INSERT INTO actor (id, workspace_id, kind, display_name, external_ref)
           VALUES (gen_random_uuid(), $1, 'human', 'Regression', 'clerk_regression')`,
          [WORKSPACE_SOLO],
        ),
      ).rejects.toThrow(/actor_identified_human_carries_an_identity/);
    });
  });
});
