import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CHECKPOINT_ACTIONS,
  CHECKPOINT_TRIGGERS,
  CONFLICT_RESOLUTIONS,
  migrate,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const TENANT_ROLE = 'mne43_tenant';

const WS_A = '88888888-8888-4888-8888-888888888888';
const WS_B = '99999999-9999-4999-8999-999999999999';

const CHECKPOINT_COLUMNS = [
  'actor_id',
  'cost_micros',
  'created_at',
  'extraction_duration_ms',
  'extraction_model',
  'id',
  'input_tokens',
  'output_tokens',
  'project_id',
  'review_state',
  'reviewed_at',
  'reviewed_by',
  'session_id',
  'summary',
  'trigger',
  'workspace_id',
];

const CHECKPOINT_ITEM_COLUMNS = ['action', 'checkpoint_id', 'item_id', 'workspace_id'];

const HANDOFF_COLUMNS = [
  'created_at',
  'from_actor',
  'id',
  'next_action',
  'project_id',
  'received_at',
  'rendered',
  'to_actor',
  'workspace_id',
];

const CONFLICT_COLUMNS = [
  'detected_at',
  'id',
  'item_a',
  'item_b',
  'project_id',
  'rationale',
  'resolution',
  'resolved_at',
  'resolved_by',
  'workspace_id',
];

const NEW_TABLES = ['checkpoint', 'checkpoint_item', 'conflict', 'handoff'];

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

const setWorkspace = async (client: Client, id: string): Promise<void> => {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, id]);
};

let schemaCounter = 0;

interface Seed {
  readonly actorId: string;
  readonly projectId: string;
  readonly sessionId: string;
  readonly itemA: string;
  readonly itemB: string;
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
  const actorId = actor.rows[0]?.id as string;

  const project = await client.query(
    'INSERT INTO project (id, workspace_id, slug) VALUES (gen_random_uuid(), $1, $2) RETURNING id',
    [workspaceId, `${slug}-proj`],
  );
  const projectId = project.rows[0]?.id as string;

  const session = await client.query(
    "INSERT INTO session (id, workspace_id, project_id, actor_id, tool, started_at) VALUES (gen_random_uuid(), $1, $2, $3, 'claude-code', now()) RETURNING id",
    [workspaceId, projectId, actorId],
  );

  const items: string[] = [];
  for (const title of [`${slug} ships on Postgres`, `${slug} ships on SQLite`]) {
    const item = await client.query(
      `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by)
       VALUES (gen_random_uuid(), $1, $2, 'decision', $3, $4) RETURNING id`,
      [workspaceId, projectId, title, actorId],
    );
    items.push(item.rows[0]?.id as string);
  }

  return {
    actorId,
    projectId,
    sessionId: session.rows[0]?.id as string,
    itemA: items[0] as string,
    itemB: items[1] as string,
  };
}

async function withSchema<T>(run: (client: Client, seed: Seed) => Promise<T>): Promise<T> {
  const schema = `mne43_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration' });
    const seed = await seedWorkspace(client, WS_A, 'acme');
    return await run(client, seed);
  } finally {
    await client.query('RESET ROLE');
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function asTenant(client: Client): Promise<void> {
  const schema = (await client.query('SELECT current_schema() AS name')).rows[0]?.name as string;
  await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${TENANT_ROLE}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO ${TENANT_ROLE}`);
  await client.query(`SET ROLE ${TENANT_ROLE}`);
}

describe.skipIf(connectionString === undefined)('checkpoint, handoff and conflict schema', () => {
  beforeAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANT_ROLE}') THEN
           CREATE ROLE ${TENANT_ROLE} NOLOGIN;
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
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne43_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('creates the four remaining vision.md §9 tables', async () => {
    await withSchema(async (client) => {
      const result = await client.query(
        'SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename',
      );
      const tables = result.rows.map((row) => row.tablename as string);

      for (const table of NEW_TABLES) {
        expect(tables).toContain(table);
      }
    });
  });

  it('gives every new table its §9 columns, with workspace_id NOT NULL on all four', async () => {
    await withSchema(async (client) => {
      const columnsOf = async (table: string): Promise<Map<string, string>> => {
        const result = await client.query(
          `SELECT column_name, is_nullable FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = $1
            ORDER BY column_name`,
          [table],
        );
        return new Map(
          result.rows.map((row) => [row.column_name as string, row.is_nullable as string]),
        );
      };

      const checkpoint = await columnsOf('checkpoint');
      const checkpointItem = await columnsOf('checkpoint_item');
      const handoff = await columnsOf('handoff');
      const conflict = await columnsOf('conflict');

      expect([...checkpoint.keys()]).toEqual(CHECKPOINT_COLUMNS);
      expect([...checkpointItem.keys()]).toEqual(CHECKPOINT_ITEM_COLUMNS);
      expect([...handoff.keys()]).toEqual(HANDOFF_COLUMNS);
      expect([...conflict.keys()]).toEqual(CONFLICT_COLUMNS);

      for (const columns of [checkpoint, checkpointItem, handoff, conflict]) {
        expect(columns.get('workspace_id')).toBe('NO');
      }

      expect(checkpoint.get('session_id')).toBe('YES');
      expect(checkpoint.get('summary')).toBe('YES');
      expect(checkpoint.get('actor_id')).toBe('NO');
      expect(checkpoint.get('trigger')).toBe('NO');

      expect(handoff.get('to_actor')).toBe('YES');
      expect(handoff.get('received_at')).toBe('YES');
      expect(handoff.get('next_action')).toBe('NO');
      expect(handoff.get('rendered')).toBe('NO');

      expect(conflict.get('resolved_at')).toBe('YES');
      expect(conflict.get('resolved_by')).toBe('YES');
      expect(conflict.get('resolution')).toBe('YES');
      expect(conflict.get('item_a')).toBe('NO');
      expect(conflict.get('item_b')).toBe('NO');
    });
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

      expect(await read('checkpoint_trigger')).toEqual([...CHECKPOINT_TRIGGERS]);
      expect(await read('checkpoint_action')).toEqual([...CHECKPOINT_ACTIONS]);
      expect(await read('conflict_resolution')).toEqual([...CONFLICT_RESOLUTIONS]);
    });
  });

  it('types trigger, action and resolution as those enums rather than text', async () => {
    await withSchema(async (client) => {
      const result = await client.query(
        `SELECT table_name, column_name, data_type, udt_name
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND (table_name, column_name) IN
                (('checkpoint', 'trigger'), ('checkpoint_item', 'action'), ('conflict', 'resolution'))
          ORDER BY table_name`,
      );

      expect(result.rows.map((row) => row.udt_name as string)).toEqual([
        'checkpoint_trigger',
        'checkpoint_action',
        'conflict_resolution',
      ]);
      expect(result.rows.every((row) => row.data_type === 'USER-DEFINED')).toBe(true);
    });
  });

  it('rejects a value outside the checkpoint_trigger enum', async () => {
    await withSchema(async (client, seed) => {
      const error = await client
        .query(
          `INSERT INTO checkpoint (id, workspace_id, project_id, actor_id, trigger)
           VALUES (gen_random_uuid(), $1, $2, $3, 'context_window_full')`,
          [WS_A, seed.projectId, seed.actorId],
        )
        .catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('22P02');
    });
  });

  it('creates the indexes the read paths depend on', async () => {
    await withSchema(async (client) => {
      const result = await client.query(
        'SELECT tablename, indexdef FROM pg_indexes WHERE schemaname = current_schema()',
      );
      const defs = (table: string): string =>
        result.rows
          .filter((row) => row.tablename === table)
          .map((row) => row.indexdef as string)
          .join('\n');

      expect(defs('checkpoint')).toContain('(workspace_id, project_id, created_at DESC)');
      expect(defs('checkpoint_item')).toContain('(item_id)');
      expect(defs('handoff')).toContain('(workspace_id, project_id)');
      expect(defs('conflict')).toMatch(
        /\(workspace_id, project_id, detected_at DESC\)[\s\S]*WHERE/,
      );
    });
  });

  it('enables and forces row level security with an isolation policy on every new table', async () => {
    await withSchema(async (client) => {
      const security = await client.query(
        `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = current_schema() AND c.relname = ANY($1)
          ORDER BY c.relname`,
        [NEW_TABLES],
      );

      expect(security.rows).toHaveLength(NEW_TABLES.length);
      for (const row of security.rows) {
        expect(row.relrowsecurity).toBe(true);
        expect(row.relforcerowsecurity).toBe(true);
      }

      const policies = await client.query(
        `SELECT tablename, policyname, qual, with_check FROM pg_policies
          WHERE schemaname = current_schema() AND tablename = ANY($1)
          ORDER BY tablename`,
        [NEW_TABLES],
      );

      expect(policies.rows.map((row) => row.policyname as string)).toEqual(
        NEW_TABLES.map((table) => `${table}_workspace_isolation`),
      );
      for (const row of policies.rows) {
        expect(row.qual).toContain('mneia.workspace_id');
        expect(row.with_check).toContain('mneia.workspace_id');
      }
    });
  });

  it('round-trips a checkpoint and attributes item writes to it', async () => {
    await withSchema(async (client, seed) => {
      const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

      await client.query(
        `INSERT INTO checkpoint (id, workspace_id, project_id, session_id, actor_id, trigger, created_at, summary)
         VALUES ($1, $2, $3, $4, $5, 'pre_compaction', '2026-03-03T10:00:00Z', $6)`,
        [
          id,
          WS_A,
          seed.projectId,
          seed.sessionId,
          seed.actorId,
          'Ruled out SQLite; hosted Postgres only.',
        ],
      );

      for (const [itemId, action] of [
        [seed.itemA, 'created'],
        [seed.itemB, 'rejected'],
      ]) {
        await client.query(
          'INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action) VALUES ($1, $2, $3, $4::checkpoint_action)',
          [WS_A, id, itemId, action],
        );
      }

      const row = (await client.query('SELECT * FROM checkpoint WHERE id = $1', [id])).rows[0];

      expect(row.workspace_id).toBe(WS_A);
      expect(row.project_id).toBe(seed.projectId);
      expect(row.session_id).toBe(seed.sessionId);
      expect(row.actor_id).toBe(seed.actorId);
      expect(row.trigger).toBe('pre_compaction');
      expect((row.created_at as Date).toISOString()).toBe('2026-03-03T10:00:00.000Z');
      expect(row.summary).toContain('SQLite');

      const links = await client.query(
        'SELECT item_id, action FROM checkpoint_item WHERE checkpoint_id = $1 ORDER BY action',
        [id],
      );
      expect(links.rows).toEqual([
        { item_id: seed.itemA, action: 'created' },
        { item_id: seed.itemB, action: 'rejected' },
      ]);
    });
  });

  it('accepts a checkpoint with no session, and rejects the same item twice in one checkpoint', async () => {
    await withSchema(async (client, seed) => {
      const id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

      await client.query(
        `INSERT INTO checkpoint (id, workspace_id, project_id, actor_id, trigger)
         VALUES ($1, $2, $3, $4, 'day_boundary')`,
        [id, WS_A, seed.projectId, seed.actorId],
      );

      const stored = (
        await client.query('SELECT session_id, summary FROM checkpoint WHERE id = $1', [id])
      ).rows[0];
      expect(stored.session_id).toBeNull();
      expect(stored.summary).toBeNull();

      await client.query(
        "INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action) VALUES ($1, $2, $3, 'created')",
        [WS_A, id, seed.itemA],
      );
      const error = await client
        .query(
          "INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action) VALUES ($1, $2, $3, 'updated')",
          [WS_A, id, seed.itemA],
        )
        .catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('23505');
    });
  });

  it('stores an open handoff with a null to_actor and marks it received', async () => {
    await withSchema(async (client, seed) => {
      const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

      await client.query(
        `INSERT INTO handoff (id, workspace_id, project_id, from_actor, next_action, rendered)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          WS_A,
          seed.projectId,
          seed.actorId,
          'Land MNE-186 before any tenant data',
          '# Handoff\n\nRLS is inert while the role holds BYPASSRLS.',
        ],
      );

      const open = (await client.query('SELECT * FROM handoff WHERE id = $1', [id])).rows[0];
      expect(open.to_actor).toBeNull();
      expect(open.received_at).toBeNull();
      expect(open.next_action).toBe('Land MNE-186 before any tenant data');
      expect(open.rendered).toContain('BYPASSRLS');
      expect(open.created_at).toBeInstanceOf(Date);

      await client.query(
        "UPDATE handoff SET to_actor = $1, received_at = '2026-03-04T09:00:00Z' WHERE id = $2",
        [seed.actorId, id],
      );

      const received = (await client.query('SELECT * FROM handoff WHERE id = $1', [id])).rows[0];
      expect(received.to_actor).toBe(seed.actorId);
      expect((received.received_at as Date).toISOString()).toBe('2026-03-04T09:00:00.000Z');
    });
  });

  it('rejects a handoff addressed to an actor in another workspace', async () => {
    await withSchema(async (client, seed) => {
      const foreign = await seedWorkspace(client, WS_B, 'globex');

      await setWorkspace(client, WS_A);
      const error = await client
        .query(
          `INSERT INTO handoff (id, workspace_id, project_id, from_actor, to_actor, next_action, rendered)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'cross tenant', '# nope')`,
          [WS_A, seed.projectId, seed.actorId, foreign.actorId],
        )
        .catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('23503');
    });
  });

  it('records an unresolved conflict and a fully resolved one', async () => {
    await withSchema(async (client, seed) => {
      const unresolved = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const resolved = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

      const openConflict = async (id: string): Promise<void> => {
        await client.query(
          `INSERT INTO conflict (id, workspace_id, project_id, item_a, item_b, detected_at)
           VALUES ($1, $2, $3, $4, $5, '2026-03-03T10:00:00Z')`,
          [id, WS_A, seed.projectId, seed.itemA, seed.itemB],
        );
      };

      await openConflict(resolved);
      await client.query(
        `UPDATE conflict
            SET resolved_at = '2026-03-05T12:00:00Z', resolved_by = $1, resolution = 'a_wins',
                rationale = 'the human constraint was confirmed first'
          WHERE id = $2`,
        [seed.actorId, resolved],
      );
      await openConflict(unresolved);

      const open = (await client.query('SELECT * FROM conflict WHERE id = $1', [unresolved]))
        .rows[0];
      expect(open.item_a).toBe(seed.itemA);
      expect(open.item_b).toBe(seed.itemB);
      expect((open.detected_at as Date).toISOString()).toBe('2026-03-03T10:00:00.000Z');
      expect(open.resolved_at).toBeNull();
      expect(open.resolved_by).toBeNull();
      expect(open.resolution).toBeNull();

      const closed = (await client.query('SELECT * FROM conflict WHERE id = $1', [resolved]))
        .rows[0];
      expect((closed.resolved_at as Date).toISOString()).toBe('2026-03-05T12:00:00.000Z');
      expect(closed.resolved_by).toBe(seed.actorId);
      expect(closed.resolution).toBe('a_wins');
      expect(closed.rationale).toBe('the human constraint was confirmed first');
    });
  });

  it('rejects a half-resolved conflict, so §10.4 cannot be satisfied by silence', async () => {
    await withSchema(async (client, seed) => {
      const insert = async (columns: string, values: string, params: readonly unknown[]) =>
        client
          .query(
            `INSERT INTO conflict (id, workspace_id, project_id, item_a, item_b, ${columns})
             VALUES (gen_random_uuid(), $1, $2, $3, $4, ${values})`,
            [WS_A, seed.projectId, seed.itemA, seed.itemB, ...params],
          )
          .catch((e: unknown) => e);

      const resolutionOnly = await insert('resolution', "'a_wins'", []);
      const timeOnly = await insert('resolved_at', 'now()', []);
      const resolverOnly = await insert('resolved_by', '$5', [seed.actorId]);
      const missingResolution = await insert('resolved_at, resolved_by', 'now(), $5', [
        seed.actorId,
      ]);

      for (const error of [resolutionOnly, timeOnly, resolverOnly, missingResolution]) {
        expect((error as { code?: string }).code).toBe('23514');
        expect((error as { constraint?: string }).constraint).toBe('conflict_resolution_is_whole');
      }

      const missingRationale = await insert(
        'resolved_at, resolved_by, resolution',
        "now(), $5, 'merged'",
        [seed.actorId],
      );
      expect((missingRationale as { constraint?: string }).constraint).toBe(
        'conflict_resolution_is_whole',
      );

      const whole = await insert(
        'resolved_at, resolved_by, resolution, rationale',
        "now(), $5, 'merged', 'both held, under different conditions'",
        [seed.actorId],
      );
      expect(whole).not.toBeInstanceOf(Error);
    });
  });

  it('cannot half-unresolve an already resolved conflict either', async () => {
    await withSchema(async (client, seed) => {
      const id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

      await client.query(
        `INSERT INTO conflict (id, workspace_id, project_id, item_a, item_b, resolved_at, resolved_by, resolution, rationale)
         VALUES ($1, $2, $3, $4, $5, now(), $6, 'both_retired', 'both were stale')`,
        [id, WS_A, seed.projectId, seed.itemA, seed.itemB, seed.actorId],
      );

      const error = await client
        .query('UPDATE conflict SET resolved_by = NULL WHERE id = $1', [id])
        .catch((e: unknown) => e);

      expect((error as { code?: string }).code).toBe('23514');
      expect((error as { constraint?: string }).constraint).toBe('conflict_resolution_is_whole');
    });
  });

  it('hides another workspace checkpoints, handoffs and conflicts under a non-bypassing role', async () => {
    await withSchema(async (client, seed) => {
      const foreign = await seedWorkspace(client, WS_B, 'globex');

      for (const [workspaceId, s, marker] of [
        [WS_A, seed, 'acme'],
        [WS_B, foreign, 'globex'],
      ] as const) {
        await setWorkspace(client, workspaceId);
        const checkpoint = await client.query(
          `INSERT INTO checkpoint (id, workspace_id, project_id, actor_id, trigger, summary)
           VALUES (gen_random_uuid(), $1, $2, $3, 'manual', $4) RETURNING id`,
          [workspaceId, s.projectId, s.actorId, marker],
        );
        await client.query(
          "INSERT INTO checkpoint_item (workspace_id, checkpoint_id, item_id, action) VALUES ($1, $2, $3, 'created')",
          [workspaceId, checkpoint.rows[0]?.id, s.itemA],
        );
        await client.query(
          `INSERT INTO handoff (id, workspace_id, project_id, from_actor, next_action, rendered)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $4)`,
          [workspaceId, s.projectId, s.actorId, marker],
        );
        await client.query(
          `INSERT INTO conflict (id, workspace_id, project_id, item_a, item_b)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
          [workspaceId, s.projectId, s.itemA, s.itemB],
        );
      }

      await asTenant(client);
      await setWorkspace(client, WS_A);

      const checkpoints = await client.query('SELECT workspace_id, summary FROM checkpoint');
      expect(checkpoints.rows).toHaveLength(1);
      expect(checkpoints.rows[0]?.summary).toBe('acme');

      const links = await client.query('SELECT workspace_id FROM checkpoint_item');
      expect(links.rows).toEqual([{ workspace_id: WS_A }]);

      const handoffs = await client.query('SELECT workspace_id, next_action FROM handoff');
      expect(handoffs.rows).toEqual([{ workspace_id: WS_A, next_action: 'acme' }]);

      const conflicts = await client.query('SELECT workspace_id FROM conflict');
      expect(conflicts.rows).toEqual([{ workspace_id: WS_A }]);

      await setWorkspace(client, WS_B);
      const otherSide = await client.query('SELECT summary FROM checkpoint');
      expect(otherSide.rows).toEqual([{ summary: 'globex' }]);

      await setWorkspace(client, '');
      const unset = await client.query('SELECT id FROM conflict');
      expect(unset.rows).toHaveLength(0);

      await client.query('RESET ROLE');
    });
  });

  it('is bypassed by a BYPASSRLS or superuser role even with FORCE, which is why the app must not connect as one', async () => {
    await withSchema(async (client, seed) => {
      const foreign = await seedWorkspace(client, WS_B, 'globex');

      for (const [workspaceId, s] of [
        [WS_A, seed],
        [WS_B, foreign],
      ] as const) {
        await setWorkspace(client, workspaceId);
        await client.query(
          `INSERT INTO handoff (id, workspace_id, project_id, from_actor, next_action, rendered)
           VALUES (gen_random_uuid(), $1, $2, $3, 'pick up', '# handoff')`,
          [workspaceId, s.projectId, s.actorId],
        );
      }

      const bypasses = await client.query(
        `SELECT current_setting('is_superuser') = 'on'
                OR EXISTS (
                  SELECT 1 FROM pg_roles g
                   WHERE (g.rolbypassrls OR g.rolsuper)
                     AND pg_has_role(current_user, g.oid, 'MEMBER')
                ) AS v`,
      );
      expect(bypasses.rows[0]?.v).toBe(true);

      await setWorkspace(client, WS_A);
      const rows = await client.query('SELECT workspace_id FROM handoff');

      expect(rows.rows).toHaveLength(2);
    });
  });
});
