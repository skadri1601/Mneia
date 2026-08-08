import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS, migrate, WORKSPACE_SETTING } from '../../packages/core/src/index.js';
import { APP_ROLE, ensureAppRole, grantSchemaToAppRole } from './app-role.js';
import { PgDriver } from './pg-driver.js';
import { SEED, seedCorpus, seedVector } from './seed.js';

const connectionString = process.env.DATABASE_URL;
const describeMaybe = connectionString === undefined ? describe.skip : describe;
const SCHEMA = `mne47_${Date.now().toString(36)}`;

let client: Client | undefined;

const connect = async (): Promise<Client> => {
  const created = new Client({ connectionString });
  await created.connect();
  return created;
};

const scopeTo = async (workspaceId: string): Promise<void> => {
  await (client as Client).query('SELECT set_config($1, $2, false)', [
    WORKSPACE_SETTING,
    workspaceId,
  ]);
};

const rows = async (sql: string, params: readonly unknown[] = []) => {
  const result = await (client as Client).query(sql, [...params]);
  return result.rows as Record<string, unknown>[];
};

afterAll(async () => {
  if (client !== undefined) {
    await client.query('RESET ROLE');
    await client.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
    await client.end();
  }
});

describeMaybe('MNE-47 seed harness and full-column round trip', () => {
  it('migrates a fresh schema and seeds the shared corpus', async () => {
    client = await connect();
    await client.query(`CREATE SCHEMA "${SCHEMA}"`);
    await client.query(`SET search_path TO "${SCHEMA}", public`);
    await ensureAppRole(client);
    await migrate(new PgDriver(client));
    await grantSchemaToAppRole(client, SCHEMA);
    await seedCorpus(client);

    await scopeTo(SEED.workspaceA);

    const perWorkspace = await rows(
      `SELECT workspace_id, count(*)::int AS total
         FROM context_item
        GROUP BY workspace_id
        ORDER BY workspace_id`,
    );

    expect(perWorkspace).toEqual([
      { workspace_id: SEED.workspaceA, total: 9 },
      { workspace_id: SEED.workspaceB, total: 1 },
    ]);
  });

  it('writes and reads back every §9 column on context_item, including the ones nothing else asserts', async () => {
    await scopeTo(SEED.workspaceA);

    const written = await rows(
      `INSERT INTO context_item
         (id, workspace_id, project_id, kind, title, body, status, asserted_by, asserted_at,
          source_session_id, source_ref, confidence, human_confirmed, load_bearing,
          last_verified_at, decay_after, valid_from, valid_to, supersedes_id,
          access_scope, supersede_reason, purge_after)
       VALUES (gen_random_uuid(), $1, $2, 'fact'::item_kind, $3, $4, 'active'::item_status, $5,
               '2026-07-10T09:00:00.000Z', $6, $7, 0.625, true, true,
               '2026-07-11T09:00:00.000Z', $8::interval, '2026-07-10T09:00:00.000Z',
               '2026-08-10T09:00:00.000Z', $9, 'workspace'::access_scope, $10,
               '2026-09-10T09:00:00.000Z')
       RETURNING *`,
      [
        SEED.workspaceA,
        SEED.projectA,
        'Every column, written once and read back',
        'The body survives a round trip, null bytes excluded at the boundary.',
        SEED.humanA,
        SEED.sessionA,
        'AGENTS.md#L42',
        '30 days',
        SEED.decisionHead,
        'the previous statement was measured on the wrong branch',
      ],
    );

    const row = written[0];
    expect(row).toBeDefined();

    const read = await rows('SELECT * FROM context_item WHERE id = $1', [row?.id]);
    const back = read[0];
    if (back === undefined) {
      throw new Error('expected the row just written to read back; found none');
    }
    expect(back).toEqual(row);

    expect(back.kind).toBe('fact');
    expect(back.title).toBe('Every column, written once and read back');
    expect(back.body).toBe('The body survives a round trip, null bytes excluded at the boundary.');
    expect(back.status).toBe('active');
    expect(back.asserted_by).toBe(SEED.humanA);
    expect(back.source_session_id).toBe(SEED.sessionA);
    expect(back.source_ref).toBe('AGENTS.md#L42');
    expect(back.confidence).toBeCloseTo(0.625, 5);
    expect(back.human_confirmed).toBe(true);
    expect(back.load_bearing).toBe(true);
    expect(back.access_scope).toBe('workspace');
    expect(back.supersedes_id).toBe(SEED.decisionHead);
    expect(back.supersede_reason).toBe('the previous statement was measured on the wrong branch');

    for (const column of [
      'asserted_at',
      'last_verified_at',
      'valid_from',
      'valid_to',
      'purge_after',
    ]) {
      expect(back[column]).toBeInstanceOf(Date);
    }
    expect((back.valid_to as Date).toISOString()).toBe('2026-08-10T09:00:00.000Z');
    expect((back.purge_after as Date).toISOString()).toBe('2026-09-10T09:00:00.000Z');
    expect(back.decay_after).toMatchObject({ days: 30 });
  });

  it('round-trips a 1536-dimension embedding with its model identity', async () => {
    await scopeTo(SEED.workspaceA);

    const stored = await rows(
      'SELECT model, dim, embedding FROM context_item_embedding WHERE item_id = $1',
      [SEED.decisionHead],
    );

    expect(stored).toHaveLength(1);
    expect(stored[0]?.model).toBe('text-embedding-3-small');
    expect(stored[0]?.dim).toBe(EMBEDDING_DIMENSIONS);

    const vector = JSON.parse(String(stored[0]?.embedding)) as number[];
    expect(vector).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(vector[0]).toBeCloseTo(0.25, 5);

    const nearest = await rows(
      `SELECT item_id FROM context_item_embedding
        ORDER BY embedding <=> $1::vector
        LIMIT 1`,
      [seedVector(0.25)],
    );
    expect(nearest[0]?.item_id).toBe(SEED.decisionHead);
  });

  it('seeds a supersede chain whose links agree in both directions', async () => {
    await scopeTo(SEED.workspaceA);

    const chain = await rows(
      `SELECT id, status, valid_to, supersedes_id, superseded_by_id, supersede_reason
         FROM context_item
        WHERE id = ANY($1::uuid[])
        ORDER BY asserted_at`,
      [[SEED.decisionOriginal, SEED.decisionSuperseding, SEED.decisionHead]],
    );

    const [original, middle, head] = chain;

    expect(original?.superseded_by_id).toBe(SEED.decisionSuperseding);
    expect(middle?.supersedes_id).toBe(SEED.decisionOriginal);
    expect(middle?.superseded_by_id).toBe(SEED.decisionHead);
    expect(head?.supersedes_id).toBe(SEED.decisionSuperseding);

    expect(original?.status).toBe('superseded');
    expect(middle?.status).toBe('superseded');
    expect(head?.status).toBe('active');
    expect(head?.superseded_by_id).toBeNull();

    expect(original?.valid_to).toBeInstanceOf(Date);
    expect(head?.valid_to).toBeNull();
    expect(middle?.supersede_reason).toBe('the embedding column was never read on the hot path');
  });

  it('seeds the mixed provenance and flags that ranking tests need', async () => {
    await scopeTo(SEED.workspaceA);

    const corpus = await rows(
      `SELECT ci.id, ci.kind, ci.status, ci.load_bearing, ci.human_confirmed,
              ci.access_scope, a.kind AS actor_kind
         FROM context_item ci
         JOIN actor a ON a.workspace_id = ci.workspace_id AND a.id = ci.asserted_by`,
    );

    expect(corpus.filter((item) => item.actor_kind === 'human').length).toBeGreaterThan(0);
    expect(corpus.filter((item) => item.actor_kind === 'agent').length).toBeGreaterThan(0);
    expect(corpus.filter((item) => item.load_bearing === true).length).toBeGreaterThan(0);
    expect(corpus.filter((item) => item.human_confirmed === false).length).toBeGreaterThan(0);
    expect(corpus.filter((item) => item.status === 'disputed')).toHaveLength(1);
    expect(corpus.filter((item) => item.status === 'superseded')).toHaveLength(2);
    expect(corpus.filter((item) => item.access_scope === 'private')).toHaveLength(1);
    expect(new Set(corpus.map((item) => item.kind))).toEqual(
      new Set(['constraint', 'decision', 'open_question', 'fact']),
    );
  });

  it('keeps the second workspace invisible under row-level security', async () => {
    await (client as Client).query(`SET ROLE ${APP_ROLE}`);
    await scopeTo(SEED.workspaceA);

    const visible = await rows('SELECT id FROM context_item WHERE id = $1', [
      SEED.otherWorkspaceItem,
    ]);
    expect(visible).toHaveLength(0);

    await scopeTo(SEED.workspaceB);
    const own = await rows('SELECT id FROM context_item WHERE id = $1', [SEED.otherWorkspaceItem]);
    expect(own).toHaveLength(1);

    await (client as Client).query('RESET ROLE');
  });
});
