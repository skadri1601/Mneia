import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ACCESS_SCOPES,
  EMBEDDING_DIMENSIONS,
  ITEM_KINDS,
  ITEM_STATUSES,
  WORKSPACE_SETTING,
  migrate,
} from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS_A = '33333333-3333-4333-8333-333333333333';
const WS_B = '44444444-4444-4444-8444-444444444444';

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

const setWorkspace = async (client: Client, id: string): Promise<void> => {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, id]);
};

const vectorLiteral = (seed: number): string =>
  `[${Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (((i + seed) % 10) / 10).toFixed(1)).join(',')}]`;

let schemaCounter = 0;

interface Seed {
  readonly actorId: string;
  readonly projectId: string;
  readonly sessionId: string;
}

async function seedWorkspace(client: Client, workspaceId: string, slug: string): Promise<Seed> {
  await setWorkspace(client, workspaceId);
  await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
    workspaceId,
    slug,
  ]);
  const actor = await client.query(
    "INSERT INTO actor (id, workspace_id, kind, display_name) VALUES (gen_random_uuid(), $1, 'human', $2) RETURNING id",
    [workspaceId, `${slug}-human`],
  );
  const project = await client.query(
    'INSERT INTO project (id, workspace_id, slug) VALUES (gen_random_uuid(), $1, $2) RETURNING id',
    [workspaceId, `${slug}-proj`],
  );
  const session = await client.query(
    "INSERT INTO session (id, workspace_id, project_id, actor_id, tool, started_at) VALUES (gen_random_uuid(), $1, $2, $3, 'claude-code', now()) RETURNING id",
    [workspaceId, project.rows[0]?.id, actor.rows[0]?.id],
  );

  return {
    actorId: actor.rows[0]?.id as string,
    projectId: project.rows[0]?.id as string,
    sessionId: session.rows[0]?.id as string,
  };
}

async function withSchema<T>(run: (client: Client, seed: Seed) => Promise<T>): Promise<T> {
  const schema = `mne42_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration' });
    const seed = await seedWorkspace(client, WS_A, 'acme');
    return await run(client, seed);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

describe.skipIf(connectionString === undefined)('context_item schema', () => {
  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne42_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('declares the three enums with exactly the vision.md values', async () => {
    await withSchema(async (client) => {
      const read = async (name: string): Promise<string[]> => {
        const result = await client.query(
          `SELECT e.enumlabel FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = $1
              AND t.typnamespace = (
                SELECT oid FROM pg_namespace WHERE nspname = current_schema()
              )
            ORDER BY e.enumsortorder`,
          [name],
        );
        return result.rows.map((row) => row.enumlabel as string);
      };

      expect(await read('item_kind')).toEqual([...ITEM_KINDS]);
      expect(await read('item_status')).toEqual([...ITEM_STATUSES]);
      expect(await read('access_scope')).toEqual([...ACCESS_SCOPES]);
    });
  });

  it('creates both indexes from vision.md', async () => {
    await withSchema(async (client) => {
      const result = await client.query(
        "SELECT indexdef FROM pg_indexes WHERE tablename = 'context_item'",
      );
      const defs = result.rows.map((row) => row.indexdef as string).join('\n');

      expect(defs).toContain('(project_id, status, kind)');
      expect(defs).toMatch(/USING ivfflat \(embedding vector_cosine_ops\)/);
    });
  });

  it('round-trips every column including embedding, decay_after and valid_to', async () => {
    await withSchema(async (client, seed) => {
      const id = '55555555-5555-4555-8555-555555555555';
      const embedding = vectorLiteral(0);

      await client.query(
        `INSERT INTO context_item (
           id, workspace_id, project_id, kind, title, body, status,
           asserted_by, asserted_at, source_session_id, source_ref,
           confidence, human_confirmed, load_bearing, last_verified_at, decay_after,
           valid_from, valid_to, access_scope, embedding
         ) VALUES (
           $1, $2, $3, 'constraint', $4, $5, 'active',
           $6, '2026-03-03T10:00:00Z', $7, $8,
           0.9, true, true, '2026-03-04T11:00:00Z', '30 days',
           '2026-03-03T10:00:00Z', '2026-04-03T10:00:00Z', 'team', $9
         )`,
        [
          id,
          WS_A,
          seed.projectId,
          'Postgres is the only engine',
          'Ruled in §11.1 — no SQLite, no local store.',
          seed.actorId,
          seed.sessionId,
          'https://github.com/skadri1601/Mneia/pull/18',
          embedding,
        ],
      );

      const row = (await client.query('SELECT * FROM context_item WHERE id = $1', [id])).rows[0];

      expect(row.workspace_id).toBe(WS_A);
      expect(row.project_id).toBe(seed.projectId);
      expect(row.kind).toBe('constraint');
      expect(row.title).toBe('Postgres is the only engine');
      expect(row.body).toContain('§11.1');
      expect(row.status).toBe('active');
      expect(row.asserted_by).toBe(seed.actorId);
      expect((row.asserted_at as Date).toISOString()).toBe('2026-03-03T10:00:00.000Z');
      expect(row.source_session_id).toBe(seed.sessionId);
      expect(row.source_ref).toContain('/pull/18');
      expect(row.confidence).toBeCloseTo(0.9, 5);
      expect(row.human_confirmed).toBe(true);
      expect(row.load_bearing).toBe(true);
      expect((row.last_verified_at as Date).toISOString()).toBe('2026-03-04T11:00:00.000Z');
      expect(row.decay_after).toEqual({ days: 30 });
      expect((row.valid_from as Date).toISOString()).toBe('2026-03-03T10:00:00.000Z');
      expect((row.valid_to as Date).toISOString()).toBe('2026-04-03T10:00:00.000Z');
      expect(row.access_scope).toBe('team');

      const storedVector = JSON.parse(row.embedding as string) as number[];
      const sentVector = JSON.parse(embedding) as number[];
      expect(storedVector).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(storedVector.every((v, i) => Math.abs(v - (sentVector[i] as number)) < 1e-6)).toBe(
        true,
      );
    });
  });

  it('links both sides of a supersedes chain', async () => {
    await withSchema(async (client, seed) => {
      const older = '66666666-6666-4666-8666-666666666666';
      const newer = '77777777-7777-4777-8777-777777777777';

      for (const [id, title] of [
        [older, 'Use SQLite locally'],
        [newer, 'Hosted Postgres only'],
      ]) {
        await client.query(
          `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by)
           VALUES ($1, $2, $3, 'decision', $4, $5)`,
          [id, WS_A, seed.projectId, title, seed.actorId],
        );
      }

      await client.query(
        "UPDATE context_item SET superseded_by_id = $1, status = 'superseded', valid_to = now() WHERE id = $2",
        [newer, older],
      );
      await client.query('UPDATE context_item SET supersedes_id = $1 WHERE id = $2', [
        older,
        newer,
      ]);

      const chain = await client.query(
        `SELECT n.id AS newer, n.supersedes_id, o.id AS older, o.superseded_by_id, o.status
           FROM context_item n JOIN context_item o ON o.id = n.supersedes_id
          WHERE n.id = $1`,
        [newer],
      );

      expect(chain.rows).toHaveLength(1);
      expect(chain.rows[0]?.supersedes_id).toBe(older);
      expect(chain.rows[0]?.superseded_by_id).toBe(newer);
      expect(chain.rows[0]?.status).toBe('superseded');
    });
  });

  it('rejects a confidence outside 0..1', async () => {
    await withSchema(async (client, seed) => {
      const error = await client
        .query(
          `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by, confidence)
           VALUES (gen_random_uuid(), $1, $2, 'fact', 'over confident', $3, 1.5)`,
          [WS_A, seed.projectId, seed.actorId],
        )
        .catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('23514');
    });
  });

  it('rejects an item asserted by an actor in another workspace', async () => {
    await withSchema(async (client, seed) => {
      const foreign = await seedWorkspace(client, WS_B, 'globex');

      await setWorkspace(client, WS_A);
      const error = await client
        .query(
          `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by)
           VALUES (gen_random_uuid(), $1, $2, 'fact', 'cross tenant', $3)`,
          [WS_A, seed.projectId, foreign.actorId],
        )
        .catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('23503');
    });
  });

  it('isolates items by workspace under a non-superuser role', async () => {
    await withSchema(async (client, seed) => {
      const foreign = await seedWorkspace(client, WS_B, 'globex');

      await setWorkspace(client, WS_B);
      await client.query(
        `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by)
         VALUES (gen_random_uuid(), $1, $2, 'fact', 'globex secret', $3)`,
        [WS_B, foreign.projectId, foreign.actorId],
      );
      await setWorkspace(client, WS_A);
      await client.query(
        `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by)
         VALUES (gen_random_uuid(), $1, $2, 'fact', 'acme fact', $3)`,
        [WS_A, seed.projectId, seed.actorId],
      );

      const schema = (await client.query('SELECT current_schema() AS name')).rows[0]?.name;
      await client.query(
        `DO $$ BEGIN
           IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mne42_tenant') THEN
             CREATE ROLE mne42_tenant NOLOGIN;
           END IF;
         END $$`,
      );
      await client.query('GRANT mne42_tenant TO CURRENT_USER');
      await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO mne42_tenant`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO mne42_tenant`);
      await client.query('SET ROLE mne42_tenant');

      await setWorkspace(client, WS_A);
      const visible = await client.query('SELECT title FROM context_item');

      expect(visible.rows).toHaveLength(1);
      expect(visible.rows[0]?.title).toBe('acme fact');

      await client.query('RESET ROLE');
    });
  });
});
