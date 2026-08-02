import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { SqlResult, SqlValue } from '../../packages/core/src/index.js';
import { WORKSPACE_SETTING, migrate } from '../../packages/core/src/index.js';
import type {
  PostgresConnectionSource,
  PostgresSession,
  ScopedStore,
  WorkspaceScope,
} from '../../packages/core/src/store/adapter/index.js';
import { PostgresStoreAdapter } from '../../packages/core/src/store/adapter/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const ACTOR_A = 'aaaaaaa1-0000-4000-8000-000000000001';
const ACTOR_B = 'bbbbbbb1-0000-4000-8000-000000000002';
const TEAM_A = 'ccccccc1-0000-4000-8000-000000000003';
const TEAM_B = 'ccccccc1-0000-4000-8000-000000000004';
const PROJECT_A = 'ddddddd1-0000-4000-8000-000000000005';
const PROJECT_B = 'ddddddd1-0000-4000-8000-000000000006';
const GHOST_ACTOR = 'eeeeeee1-0000-4000-8000-000000000007';

const SCOPE_A: WorkspaceScope = { workspaceId: WS_A, actorId: ACTOR_A };
const SCOPE_B: WorkspaceScope = { workspaceId: WS_B, actorId: ACTOR_B };

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

class SchemaSession implements PostgresSession {
  constructor(private readonly client: Client) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    const result =
      params.length === 0 ? await this.client.query(sql) : await this.client.query(sql, [...params]);
    return { rows: result.rows as TRow[] };
  }

  async release(): Promise<void> {}
}

class SchemaConnectionSource implements PostgresConnectionSource {
  private readonly clients: Client[] = [];
  private last: SchemaSession | null = null;

  constructor(private readonly schema: string) {}

  async acquire(): Promise<PostgresSession> {
    const client = await connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    this.clients.push(client);
    const session = new SchemaSession(client);
    this.last = session;
    return session;
  }

  get lastSession(): SchemaSession {
    if (this.last === null) {
      throw new Error('expected a session to have been acquired; none was');
    }
    return this.last;
  }

  async close(): Promise<void> {
    const open = this.clients.splice(0, this.clients.length);
    for (const client of open) {
      await client.end();
    }
  }
}

const readWorkspaceGuc = async (session: SchemaSession): Promise<string | null> => {
  const result = await session.execute<{ value: string | null }>(
    'SELECT current_setting($1, true) AS value',
    [WORKSPACE_SETTING],
  );
  return result.rows[0]?.value ?? null;
};

async function seed(client: Client): Promise<void> {
  const workspaces: readonly (readonly [string, string, string, string, string])[] = [
    [WS_A, 'acme', ACTOR_A, TEAM_A, PROJECT_A],
    [WS_B, 'globex', ACTOR_B, TEAM_B, PROJECT_B],
  ];

  for (const [workspaceId, slug, actorId, teamId, projectId] of workspaces) {
    await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
    await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
      workspaceId,
      slug,
    ]);
    await client.query(
      'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
      [actorId, workspaceId, 'human', `${slug} lead`],
    );
    await client.query(
      'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $3)',
      [teamId, workspaceId, `${slug}-eng`],
    );
    await client.query(
      'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
      [workspaceId, teamId, actorId, 'lead'],
    );
    await client.query(
      'INSERT INTO project (id, workspace_id, team_id, slug) VALUES ($1, $2, $3, $4)',
      [projectId, workspaceId, teamId, `${slug}-platform`],
    );
  }
}

let schemaCounter = 0;

async function withAdapter(
  run: (adapter: PostgresStoreAdapter, source: SchemaConnectionSource) => Promise<void>,
): Promise<void> {
  const schema = `mne44_${process.pid}_${++schemaCounter}`;
  const setup = await connect();
  const source = new SchemaConnectionSource(schema);

  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(setup), { appliedBy: 'integration' });
    await seed(setup);

    await run(new PostgresStoreAdapter(source), source);
  } finally {
    await source.close();
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setup.end();
  }
}

const newItem = (projectId: string, actorId: string, title: string) => ({
  projectId,
  kind: 'decision' as const,
  title,
  assertedBy: actorId,
});

describe.skipIf(connectionString === undefined)('postgres store adapter', () => {
  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne44_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('sets the workspace GUC inside the transaction and lets it die with the transaction', async () => {
    await withAdapter(async (adapter, source) => {
      let inside: string | null = null;

      await adapter.withScope(SCOPE_A, async (store) => {
        inside = await readWorkspaceGuc(source.lastSession);
        expect(store.scope.workspaceId).toBe(WS_A);
      });

      expect(inside).toBe(WS_A);

      const after = await readWorkspaceGuc(source.lastSession);
      expect(after === null || after === '').toBe(true);
    });
  });

  it('detaches the scoped store when the callback returns, so it cannot outlive its transaction', async () => {
    await withAdapter(async (adapter) => {
      let escaped: ScopedStore | undefined = undefined;

      await adapter.withScope(SCOPE_A, async (store) => {
        escaped = store;
        expect(await store.getActor(ACTOR_A)).not.toBeNull();
      });

      if (escaped === undefined) {
        throw new Error('expected withScope to have handed the callback a store; it did not');
      }

      await expect(escaped.getActor(ACTOR_A)).rejects.toThrow(
        /usable only inside the withScope callback/,
      );
    });
  });

  it('keeps one workspace from reading another workspace rows through the adapter', async () => {
    await withAdapter(async (adapter) => {
      const itemA = await adapter.withScope(SCOPE_A, async (store) =>
        store.insertContextItem(newItem(PROJECT_A, ACTOR_A, 'acme picks Postgres RLS')),
      );
      const itemB = await adapter.withScope(SCOPE_B, async (store) =>
        store.insertContextItem(newItem(PROJECT_B, ACTOR_B, 'globex picks schema-per-tenant')),
      );

      expect(itemA.workspaceId).toBe(WS_A);
      expect(itemB.workspaceId).toBe(WS_B);

      await adapter.withScope(SCOPE_A, async (store) => {
        const mine = await store.listContextItems({ projectId: PROJECT_A });
        expect(mine.map((item) => item.id)).toEqual([itemA.id]);

        expect(await store.getContextItem(itemB.id)).toBeNull();
        expect(await store.listContextItems({ projectId: PROJECT_B })).toHaveLength(0);
        expect(await store.getProject(PROJECT_B)).toBeNull();
        expect(await store.getActor(ACTOR_B)).toBeNull();
      });

      await adapter.withScope(SCOPE_B, async (store) => {
        expect(await store.getContextItem(itemA.id)).toBeNull();
        const mine = await store.listContextItems({ projectId: PROJECT_B });
        expect(mine.map((item) => item.id)).toEqual([itemB.id]);
      });
    });
  });

  it('links a superseded item in both directions', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const original = await store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'ship schema-per-tenant'),
          kind: 'decision',
          loadBearing: true,
        });

        const replacement = await store.supersedeContextItem(original.id, {
          ...newItem(PROJECT_A, ACTOR_A, 'ship shared schema with RLS'),
          body: 'MNE-172 closed §11.2 Q3.',
          loadBearing: true,
        });

        expect(replacement.supersedesId).toBe(original.id);
        expect(replacement.status).toBe('active');
        expect(replacement.validTo).toBeNull();

        const previous = await store.getContextItem(original.id);
        expect(previous?.status).toBe('superseded');
        expect(previous?.supersededById).toBe(replacement.id);
        expect(previous?.validTo).not.toBeNull();

        const active = await store.listContextItems({
          projectId: PROJECT_A,
          statuses: ['active'],
        });
        expect(active.map((item) => item.id)).toEqual([replacement.id]);
      });
    });
  });

  it('writes a checkpoint, its items, and its links in one transaction', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const result = await store.writeCheckpoint({
          checkpoint: {
            projectId: PROJECT_A,
            actorId: ACTOR_A,
            trigger: 'task_boundary',
            summary: 'landed the store adapter',
          },
          items: [
            { action: 'created', item: newItem(PROJECT_A, ACTOR_A, 'adapter owns the filter') },
            {
              action: 'created',
              item: {
                ...newItem(PROJECT_A, ACTOR_A, 'never interpolate workspace_id'),
                kind: 'constraint',
                loadBearing: true,
              },
            },
          ],
        });

        expect(result.written).toHaveLength(2);
        expect(result.items).toHaveLength(2);
        expect(result.items.map((link) => link.checkpointId)).toEqual([
          result.checkpoint.id,
          result.checkpoint.id,
        ]);
        expect(result.checkpoint.workspaceId).toBe(WS_A);

        const stored = await store.getCheckpoint(result.checkpoint.id);
        expect(stored?.summary).toBe('landed the store adapter');
        expect(await store.listCheckpoints(PROJECT_A)).toHaveLength(1);
        expect(await store.listContextItems({ projectId: PROJECT_A })).toHaveLength(2);
      });
    });
  });

  it('rolls a checkpoint back completely when one of its items fails', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        await expect(
          store.writeCheckpoint({
            checkpoint: { projectId: PROJECT_A, actorId: ACTOR_A, trigger: 'manual' },
            items: [
              { action: 'created', item: newItem(PROJECT_A, ACTOR_A, 'this one is valid') },
              { action: 'created', item: newItem(PROJECT_A, GHOST_ACTOR, 'asserted by nobody') },
            ],
          }),
        ).rejects.toThrow();

        expect(await store.listContextItems({ projectId: PROJECT_A })).toHaveLength(0);
        expect(await store.listCheckpoints(PROJECT_A)).toHaveLength(0);

        const survivor = await store.insertContextItem(
          newItem(PROJECT_A, ACTOR_A, 'the transaction survived the rollback'),
        );
        expect(survivor.id).not.toBe('');
      });
    });
  });

  it('records a handoff, lets an open one be claimed, and refuses a second receipt', async () => {
    await withAdapter(async (adapter) => {
      const handoff = await adapter.withScope(SCOPE_A, async (store) =>
        store.createHandoff({
          projectId: PROJECT_A,
          fromActor: ACTOR_A,
          nextAction: 'land migration 0006',
          rendered: '# Handoff\n\nNext: land migration 0006',
        }),
      );

      expect(handoff.toActor).toBeNull();
      expect(handoff.receivedAt).toBeNull();

      await adapter.withScope(SCOPE_A, async (store) => {
        const received = await store.receiveHandoff(handoff.id, ACTOR_A);
        expect(received.receivedAt).not.toBeNull();
        expect(received.toActor).toBe(ACTOR_A);

        await expect(store.receiveHandoff(handoff.id, ACTOR_A)).rejects.toThrow(
          /already received at/,
        );

        expect((await store.getHandoff(handoff.id))?.receivedAt).not.toBeNull();
      });
    });
  });

  it('records a conflict, lists it while open, and refuses to resolve it twice', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const itemA = await store.insertContextItem(
          newItem(PROJECT_A, ACTOR_A, 'deploy on Fridays'),
        );
        const itemB = await store.insertContextItem(
          newItem(PROJECT_A, ACTOR_A, 'never deploy on Fridays'),
        );

        const conflict = await store.recordConflict({
          projectId: PROJECT_A,
          itemA: itemA.id,
          itemB: itemB.id,
        });
        expect(conflict.resolvedAt).toBeNull();
        expect(await store.listOpenConflicts(PROJECT_A)).toHaveLength(1);

        const resolved = await store.resolveConflict({
          conflictId: conflict.id,
          resolvedBy: ACTOR_A,
          resolution: 'b_wins',
        });
        expect(resolved.resolution).toBe('b_wins');
        expect(await store.listOpenConflicts(PROJECT_A)).toHaveLength(0);

        await expect(
          store.resolveConflict({
            conflictId: conflict.id,
            resolvedBy: ACTOR_A,
            resolution: 'a_wins',
          }),
        ).rejects.toThrow(/expected conflict .* to be open/);
      });
    });
  });

  it('opens and closes a session against the scoped actor', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const project = await store.getProjectBySlug('acme-platform');
        expect(project?.id).toBe(PROJECT_A);

        const session = await store.createSession(PROJECT_A, 'claude-code');
        expect(session.actorId).toBe(ACTOR_A);
        expect(session.endedAt).toBeNull();

        const ended = await store.endSession(session.id);
        expect(ended.endedAt).not.toBeNull();
      });
    });
  });

  it('refuses arguments that are not UUIDs before they reach SQL', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        await expect(store.getActor('actor-1')).rejects.toThrow(
          /expected id to be a UUID; received "actor-1"/,
        );
        await expect(
          store.listContextItems({ projectId: PROJECT_A, limit: 0 }),
        ).rejects.toThrow(/expected filter.limit to be an integer between 1 and 1000/);
      });

      await expect(adapter.withScope({ workspaceId: 'nope', actorId: ACTOR_A }, async () => {})).rejects.toThrow(
        /expected scope.workspaceId to be a UUID/,
      );
    });
  });
});
