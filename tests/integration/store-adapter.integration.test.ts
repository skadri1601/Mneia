import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { SqlResult, SqlValue } from '../../packages/core/src/index.js';
import {
  EMBEDDING_DIMENSIONS,
  migrate,
  SupersedeNotAllowedError,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import type {
  PostgresConnectionSource,
  PostgresSession,
  ScopedStore,
  WorkspaceScope,
} from '../../packages/core/src/store/adapter/index.js';
import { PostgresStoreAdapter } from '../../packages/core/src/store/adapter/index.js';
import { APP_ROLE, ensureAppRole, grantSchemaToAppRole } from './app-role.js';
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
const GHOST_ITEM = 'eeeeeee1-0000-4000-8000-000000000007';
const AGENT_A = 'fffffff1-0000-4000-8000-000000000008';

const SCOPE_A: WorkspaceScope = { workspaceId: WS_A, actorId: ACTOR_A };
const SCOPE_B: WorkspaceScope = { workspaceId: WS_B, actorId: ACTOR_B };
const SCOPE_AGENT_A: WorkspaceScope = { workspaceId: WS_A, actorId: AGENT_A };

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
      params.length === 0
        ? await this.client.query(sql)
        : await this.client.query(sql, [...params]);
    return { rows: result.rows as TRow[] };
  }

  async release(): Promise<void> {}

  async discard(): Promise<void> {
    await this.client.end();
  }
}

class SchemaConnectionSource implements PostgresConnectionSource {
  private readonly clients: Client[] = [];
  private last: SchemaSession | null = null;

  constructor(private readonly schema: string) {}

  async acquire(): Promise<PostgresSession> {
    const client = await connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    await client.query(`SET ROLE ${APP_ROLE}`);
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

  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS_A]);
  await client.query(
    'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3, $4)',
    [AGENT_A, WS_A, 'agent', 'acme coding agent'],
  );
  await client.query(
    'INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, $4)',
    [WS_A, TEAM_A, AGENT_A, 'member'],
  );
}

async function rawRows(
  client: Client,
  workspaceId: string,
  sql: string,
): Promise<readonly Record<string, unknown>[]> {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
  const result = await client.query(sql);
  return result.rows as Record<string, unknown>[];
}

let schemaCounter = 0;

async function withAdapter(
  run: (
    adapter: PostgresStoreAdapter,
    source: SchemaConnectionSource,
    setup: Client,
  ) => Promise<void>,
): Promise<void> {
  const schema = `mne44_${process.pid}_${++schemaCounter}`;
  const setup = await connect();
  const source = new SchemaConnectionSource(schema);

  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(setup), { appliedBy: 'integration' });
    await ensureAppRole(setup);
    await grantSchemaToAppRole(setup, schema);
    await seed(setup);

    await run(new PostgresStoreAdapter(source), source, setup);
  } finally {
    await source.close();
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setup.end();
  }
}

const newItem = (projectId: string, _actorId: string, title: string) => ({
  projectId,
  kind: 'decision' as const,
  title,
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
      let escaped: ScopedStore | undefined;

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

  it('returns active candidates, mandatory constraints, and recent superseded items together', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const previous = await store.insertContextItem(
          newItem(PROJECT_A, ACTOR_A, 'Use the legacy deployment path'),
        );
        const replacement = await store.supersedeContextItem(previous.id, {
          ...newItem(PROJECT_A, ACTOR_A, 'Use the guarded deployment path'),
          supersedesId: previous.id,
        });
        const constraint = await store.insertContextItem({
          projectId: PROJECT_A,
          kind: 'constraint',
          title: 'Never deploy without the schema gate',
          loadBearing: true,
        });

        const select = store.selectRehydrationCandidates;
        expect(select).toBeDefined();
        if (select === undefined) return;

        const groups = await select.call(store, {
          projectId: PROJECT_A,
          asOf: new Date(Date.now() + 60_000),
          candidateLimit: 160,
          mandatoryLimit: 1000,
          supersededLimit: 5,
        });

        expect(groups.candidates.map((item) => item.id)).toEqual(
          expect.arrayContaining([replacement.id, constraint.id]),
        );
        expect(groups.mandatory.map((item) => item.id)).toEqual([constraint.id]);
        expect(groups.superseded.map((item) => item.id)).toEqual([previous.id]);
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

  it('never lets an agent assertion supersede a human-confirmed item, with no MCP or CLI in the path', async () => {
    await withAdapter(async (adapter, _source, setup) => {
      const confirmed = await adapter.withScope(SCOPE_A, async (store) =>
        store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'never deploy on Fridays'),
          kind: 'constraint',
          humanConfirmed: true,
          loadBearing: true,
        }),
      );

      const refusal = await adapter
        .withScope(SCOPE_AGENT_A, async (store) =>
          store.writeCheckpoint({
            checkpoint: { projectId: PROJECT_A, actorId: AGENT_A, trigger: 'task_boundary' },
            items: [
              {
                action: 'superseded',
                item: {
                  ...newItem(PROJECT_A, AGENT_A, 'deploy on Fridays behind a flag'),
                  kind: 'constraint',
                  supersedesId: confirmed.id,
                },
              },
            ],
          }),
        )
        .catch((caught: unknown) => caught);

      expect(refusal).toBeInstanceOf(SupersedeNotAllowedError);
      expect(refusal).toMatchObject({
        outcome: 'requires_human_confirmation',
        itemId: confirmed.id,
      });

      const target = await adapter.withScope(SCOPE_A, (store) =>
        store.getContextItem(confirmed.id),
      );
      expect(target?.status).toBe('active');
      expect(target?.supersededById).toBeNull();
      expect(target?.validTo).toBeNull();
      expect(target?.humanConfirmed).toBe(true);

      const survivors = await rawRows(setup, WS_A, 'SELECT id FROM context_item');
      expect(survivors.map((row) => row.id)).toEqual([confirmed.id]);
    });
  });

  it('lets a human supersede an agent-asserted item', async () => {
    await withAdapter(async (adapter) => {
      const asserted = await adapter.withScope(SCOPE_AGENT_A, async (store) =>
        store.insertContextItem(newItem(PROJECT_A, AGENT_A, 'the queue is RabbitMQ')),
      );
      expect(asserted.humanConfirmed).toBe(false);

      const result = await adapter.withScope(SCOPE_A, async (store) =>
        store.writeCheckpoint({
          checkpoint: { projectId: PROJECT_A, actorId: ACTOR_A, trigger: 'task_boundary' },
          items: [
            {
              action: 'superseded',
              item: {
                ...newItem(PROJECT_A, ACTOR_A, 'the queue is Postgres LISTEN/NOTIFY'),
                humanConfirmed: true,
                supersedesId: asserted.id,
              },
            },
          ],
        }),
      );

      const replacement = result.written[0];
      expect(replacement?.supersedesId).toBe(asserted.id);

      const previous = await adapter.withScope(SCOPE_A, (store) =>
        store.getContextItem(asserted.id),
      );
      expect(previous?.status).toBe('superseded');
      expect(previous?.supersededById).toBe(replacement?.id);
    });
  });

  it('refuses to supersede a row that is no longer the head of its chain', async () => {
    await withAdapter(async (adapter) => {
      const original = await adapter.withScope(SCOPE_A, async (store) =>
        store.insertContextItem(newItem(PROJECT_A, ACTOR_A, 'ship the adapter behind a flag')),
      );
      const first = await adapter.withScope(SCOPE_A, async (store) =>
        store.supersedeContextItem(original.id, newItem(PROJECT_A, ACTOR_A, 'ship the adapter')),
      );

      const refusal = await adapter
        .withScope(SCOPE_A, async (store) =>
          store.writeCheckpoint({
            checkpoint: { projectId: PROJECT_A, actorId: ACTOR_A, trigger: 'manual' },
            items: [
              {
                action: 'superseded',
                item: {
                  ...newItem(PROJECT_A, ACTOR_A, 'ship the adapter next week'),
                  supersedesId: original.id,
                },
              },
            ],
          }),
        )
        .catch((caught: unknown) => caught);

      expect(refusal).toBeInstanceOf(SupersedeNotAllowedError);
      expect(refusal).toMatchObject({ outcome: 'refused', itemId: original.id });

      const head = await adapter.withScope(SCOPE_A, (store) => store.getContextItem(original.id));
      expect(head?.supersededById).toBe(first.id);
    });
  });

  it('refuses a vector the caller cannot attribute to a model, before it reaches the database', async () => {
    await withAdapter(async (adapter, _source, setup) => {
      const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => (i % 10) / 10);

      await expect(
        adapter.withScope(SCOPE_A, async (store) =>
          store.insertContextItem({
            ...newItem(PROJECT_A, ACTOR_A, 'an anonymous vector'),
            embedding: vector,
          }),
        ),
      ).rejects.toThrow(/embeddingModel.*embedding.*received none/s);

      await expect(
        adapter.withScope(SCOPE_A, async (store) =>
          store.insertContextItem({
            ...newItem(PROJECT_A, ACTOR_A, 'a model with nothing to attribute'),
            embeddingModel: 'openai:text-embedding-3-small',
          }),
        ),
      ).rejects.toThrow(/expected item.embedding to hold a vector/);

      expect(await rawRows(setup, WS_A, 'SELECT id FROM context_item')).toHaveLength(0);

      const stored = await adapter.withScope(SCOPE_A, async (store) =>
        store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'a vector that names its model'),
          embedding: vector,
          embeddingModel: 'openai:text-embedding-3-small',
        }),
      );

      expect(stored.embeddingModel).toBe('openai:text-embedding-3-small');
      expect(stored.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    });
  });

  it('lets only one of two concurrent supersedes of the same row win', async () => {
    await withAdapter(async (adapter, _source, setup) => {
      const original = await adapter.withScope(SCOPE_A, async (store) =>
        store.insertContextItem(
          newItem(PROJECT_A, ACTOR_A, 'the store adapter is the choke point'),
        ),
      );

      const race = (title: string) =>
        adapter.withScope(SCOPE_A, async (store) =>
          store.writeCheckpoint({
            checkpoint: { projectId: PROJECT_A, actorId: ACTOR_A, trigger: 'manual' },
            items: [
              {
                action: 'superseded',
                item: { ...newItem(PROJECT_A, ACTOR_A, title), supersedesId: original.id },
              },
            ],
          }),
        );

      const outcomes = await Promise.allSettled([race('successor one'), race('successor two')]);
      const failures: unknown[] = outcomes.flatMap((outcome) =>
        outcome.status === 'rejected' ? [outcome.reason] : [],
      );

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0]).toBeInstanceOf(SupersedeNotAllowedError);
      expect(failures[0]).toMatchObject({ outcome: 'refused', itemId: original.id });

      const head = await adapter.withScope(SCOPE_A, (store) => store.getContextItem(original.id));
      expect(head?.supersededById).not.toBeNull();

      expect(await rawRows(setup, WS_A, 'SELECT id FROM checkpoint')).toHaveLength(1);
      expect(await rawRows(setup, WS_A, 'SELECT id FROM context_item')).toHaveLength(2);
    });
  });

  it('rolls the whole checkpoint back when one of its items is refused', async () => {
    await withAdapter(async (adapter, _source, setup) => {
      const confirmed = await adapter.withScope(SCOPE_A, async (store) =>
        store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'RLS is mandatory on every table'),
          kind: 'constraint',
          humanConfirmed: true,
        }),
      );

      await expect(
        adapter.withScope(SCOPE_AGENT_A, async (store) =>
          store.writeCheckpoint({
            checkpoint: { projectId: PROJECT_A, actorId: AGENT_A, trigger: 'day_boundary' },
            items: [
              {
                action: 'created',
                item: newItem(PROJECT_A, AGENT_A, 'this item is perfectly valid on its own'),
              },
              {
                action: 'superseded',
                item: {
                  ...newItem(PROJECT_A, AGENT_A, 'RLS is optional on preview branches'),
                  kind: 'constraint',
                  supersedesId: confirmed.id,
                },
              },
            ],
          }),
        ),
      ).rejects.toThrow(/§10.1 step 5/);

      expect(await rawRows(setup, WS_A, 'SELECT id FROM checkpoint')).toHaveLength(0);
      expect(await rawRows(setup, WS_A, 'SELECT item_id FROM checkpoint_item')).toHaveLength(0);

      const survivors = await rawRows(setup, WS_A, 'SELECT id FROM context_item');
      expect(survivors.map((row) => row.id)).toEqual([confirmed.id]);
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

  it('ranks by cosine distance without tripping over the workspace_id both tables carry', async () => {
    await withAdapter(async (adapter, _source, setup) => {
      const ids: string[] = [];

      await adapter.withScope(SCOPE_A, async (store) => {
        for (const title of ['prefers Postgres', 'prefers SQLite', 'prefers Dynamo']) {
          const item = await store.insertContextItem(newItem(PROJECT_A, ACTOR_A, title));
          ids.push(item.id);
        }
      });

      await setup.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS_A]);
      for (const [index, id] of ids.entries()) {
        await setup.query(
          `INSERT INTO context_item_embedding (workspace_id, item_id, model, dim, embedding)
           VALUES ($1, $2, 'openai:text-embedding-3-small', $3, $4)`,
          [
            WS_A,
            id,
            EMBEDDING_DIMENSIONS,
            `[${Array.from({ length: EMBEDDING_DIMENSIONS }, (_, position) =>
              position === index ? 1 : 0,
            ).join(',')}]`,
          ],
        );
      }

      await adapter.withScope(SCOPE_A, async (store) => {
        const found = await store.searchContextItems({
          projectId: PROJECT_A,
          statuses: ['active'],
          embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, (_, position) =>
            position === 1 ? 1 : 0,
          ),
          embeddingModel: 'openai:text-embedding-3-small',
          withEmbedding: true,
          limit: 3,
        });

        expect(found).toHaveLength(3);
        expect(found[0]?.id).toBe(ids[1]);
      });
    });
  });

  it('records a conflict row for a detected contradiction in the same transaction as the item', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const existing = await store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'rehydration p95 stays under 300ms'),
          kind: 'constraint',
        });

        const result = await store.writeCheckpoint({
          checkpoint: { projectId: PROJECT_A, actorId: ACTOR_A, trigger: 'task_boundary' },
          items: [
            {
              action: 'created',
              item: {
                ...newItem(PROJECT_A, ACTOR_A, 'rehydration p95 stays under 500ms'),
                kind: 'constraint',
              },
              conflictsWith: existing.id,
            },
          ],
        });

        expect(result.conflicts).toHaveLength(1);
        const [conflict] = result.conflicts;
        expect(conflict?.itemA).toBe(existing.id);
        expect(conflict?.itemB).toBe(result.written[0]?.id);
        expect(conflict?.resolvedAt).toBeNull();

        const open = await store.listOpenConflicts(PROJECT_A);
        expect(open.map((entry) => entry.id)).toEqual([conflict?.id]);
      });
    });
  });

  it('leaves the existing item active when a contradiction is only detected, never auto-resolving it', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const existing = await store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'never log user content'),
          kind: 'constraint',
        });

        await store.writeCheckpoint({
          checkpoint: { projectId: PROJECT_A, actorId: ACTOR_A, trigger: 'task_boundary' },
          items: [
            {
              action: 'created',
              item: {
                ...newItem(PROJECT_A, ACTOR_A, 'log user content for debugging'),
                kind: 'constraint',
              },
              conflictsWith: existing.id,
            },
          ],
        });

        const stored = await store.getContextItem(existing.id);
        expect(stored?.status).toBe('active');
        expect(stored?.supersededById).toBeNull();
      });
    });
  });

  it('records the conflict and the supersession together when a human confirms a contradiction', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const existing = await store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'deploy from main only'),
          kind: 'constraint',
        });

        const result = await store.writeCheckpoint({
          checkpoint: { projectId: PROJECT_A, actorId: ACTOR_A, trigger: 'manual' },
          items: [
            {
              action: 'superseded',
              item: {
                ...newItem(PROJECT_A, ACTOR_A, 'deploy from any release branch'),
                kind: 'constraint',
                supersedesId: existing.id,
              },
              conflictsWith: existing.id,
            },
          ],
        });

        expect(result.conflicts).toHaveLength(1);
        expect(result.written[0]?.supersedesId).toBe(existing.id);

        const previous = await store.getContextItem(existing.id);
        expect(previous?.status).toBe('superseded');
        expect(previous?.supersededById).toBe(result.written[0]?.id);
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
              {
                action: 'superseded',
                item: {
                  ...newItem(PROJECT_A, ACTOR_A, 'supersedes an item that is not there'),
                  supersedesId: GHOST_ITEM,
                },
              },
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
          rationale: 'b cites the newer benchmark',
        });
        expect(resolved.resolution).toBe('b_wins');
        expect(resolved.rationale).toBe('b cites the newer benchmark');
        expect(await store.listOpenConflicts(PROJECT_A)).toHaveLength(0);

        await expect(
          store.resolveConflict({
            conflictId: conflict.id,
            resolvedBy: ACTOR_A,
            resolution: 'a_wins',
            rationale: 'a second opinion, arriving too late',
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

        const session = await store.createSession(PROJECT_A, 'mcp', {
          clientName: 'claude-code',
          clientVersion: '1.0.90',
          clientSessionRef: 'session-ref',
          clientSessionName: 'MNE-86 dogfood',
          clientSessionUrl: 'https://example.invalid/sessions/session-ref',
        });
        expect(session.actorId).toBe(ACTOR_A);
        expect(session).toMatchObject({
          tool: 'mcp',
          clientName: 'claude-code',
          clientVersion: '1.0.90',
          clientSessionRef: 'session-ref',
          clientSessionName: 'MNE-86 dogfood',
          clientSessionUrl: 'https://example.invalid/sessions/session-ref',
        });
        expect(session.endedAt).toBeNull();

        const sourced = await store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'session provenance round trip'),
          sourceSessionId: session.id,
        });
        const reread = await store.getContextItem(sourced.id);
        expect(reread?.provenance).toEqual({
          actorId: ACTOR_A,
          actorKind: 'human',
          actorDisplayName: 'acme lead',
          sourceSessionId: session.id,
          sessionTool: 'mcp',
          clientName: 'claude-code',
          clientVersion: '1.0.90',
          clientSessionRef: 'session-ref',
          clientSessionName: 'MNE-86 dogfood',
          clientSessionUrl: 'https://example.invalid/sessions/session-ref',
          status: 'complete',
          missingFields: [],
        });

        const ended = await store.endSession(session.id);
        expect(ended.endedAt).not.toBeNull();
      });
    });
  });

  it('does not expose session metadata from another project and actor as item provenance', async () => {
    const foreignProject = 'aaaaaaa1-0000-4000-8000-000000000009';
    const foreignSession = 'aaaaaaa1-0000-4000-8000-000000000010';

    await withAdapter(async (adapter, _source, setup) => {
      await setup.query(
        `INSERT INTO project (id, workspace_id, slug, display_name)
         VALUES ($1, $2, 'foreign-session-project', 'Foreign session project')`,
        [foreignProject, WS_A],
      );
      await setup.query(
        `INSERT INTO session (
           id, workspace_id, project_id, actor_id, tool,
           client_name, client_version, client_session_ref, client_session_name, client_session_url,
           started_at)
         VALUES ($1, $2, $3, $4, 'mcp', 'codex', '1.2.3', 'foreign-ref',
                 'Foreign session', 'https://example.invalid/sessions/foreign-ref', now())`,
        [foreignSession, WS_A, foreignProject, AGENT_A],
      );

      await adapter.withScope(SCOPE_A, async (store) => {
        const written = await store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'foreign session metadata stays hidden'),
          sourceSessionId: foreignSession,
        });
        const reread = await store.getContextItem(written.id);

        expect(reread?.provenance).toEqual({
          actorId: ACTOR_A,
          actorKind: 'human',
          actorDisplayName: 'acme lead',
          sourceSessionId: null,
          sessionTool: null,
          clientName: null,
          clientVersion: null,
          clientSessionRef: null,
          clientSessionName: null,
          clientSessionUrl: null,
          status: 'partial',
          missingFields: [
            'sourceSessionId',
            'sessionTool',
            'clientName',
            'clientVersion',
            'clientSessionRef',
            'clientSessionName',
            'clientSessionUrl',
          ],
        });
      });
    });
  });

  it('writes decay_after instead of silently dropping it', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        const withDecay = await store.insertContextItem({
          ...newItem(PROJECT_A, ACTOR_A, 'the staging key rotates weekly'),
          kind: 'fact',
          decayAfter: 604_800_000,
        });
        expect(withDecay.decayAfter).toBe(604_800_000);

        const reread = await store.getContextItem(withDecay.id);
        expect(reread?.decayAfter).toBe(604_800_000);

        const without = await store.insertContextItem(
          newItem(PROJECT_A, ACTOR_A, 'no decay on this one'),
        );
        expect(without.decayAfter).toBeNull();

        await expect(
          store.insertContextItem({
            ...newItem(PROJECT_A, ACTOR_A, 'negative decay'),
            decayAfter: -1,
          }),
        ).rejects.toThrow(/expected item.decayAfter to be a non-negative number of milliseconds/);
      });
    });
  });

  it('creates a project inside the scoped workspace, with display_name and a nullable repo', async () => {
    await withAdapter(async (adapter) => {
      const created = await adapter.withScope(SCOPE_A, async (store) =>
        store.createProject({ slug: 'q3-enterprise-motion', displayName: 'Q3 enterprise motion' }),
      );

      expect(created.workspaceId).toBe(WS_A);
      expect(created.slug).toBe('q3-enterprise-motion');
      expect(created.repoUrl).toBeNull();
      expect(created.teamId).toBeNull();

      await adapter.withScope(SCOPE_A, async (store) => {
        expect((await store.getProjectBySlug('q3-enterprise-motion'))?.id).toBe(created.id);
      });

      await adapter.withScope(SCOPE_B, async (store) => {
        expect(await store.getProject(created.id)).toBeNull();
      });
    });
  });

  it('confirms an item only for a human actor, and never for an agent', async () => {
    await withAdapter(async (adapter) => {
      const item = await adapter.withScope(SCOPE_AGENT_A, async (store) =>
        store.insertContextItem({
          ...newItem(PROJECT_A, AGENT_A, 'we should drop the queue'),
          kind: 'decision',
        }),
      );
      expect(item.humanConfirmed).toBe(false);

      await adapter.withScope(SCOPE_AGENT_A, async (store) => {
        await expect(
          store.confirmContextItem({ id: item.id, confirmedBy: AGENT_A }),
        ).rejects.toThrow(/to be an actor of kind "human"; received "agent"/);
      });

      await adapter.withScope(SCOPE_A, async (store) => {
        const stillUnconfirmed = await store.getContextItem(item.id);
        expect(stillUnconfirmed?.humanConfirmed).toBe(false);

        const confirmed = await store.confirmContextItem({
          id: item.id,
          confirmedBy: ACTOR_A,
          loadBearing: true,
          accessScope: 'team',
          title: 'we keep the queue, with a dead-letter path',
        });

        expect(confirmed.humanConfirmed).toBe(true);
        expect(confirmed.loadBearing).toBe(true);
        expect(confirmed.accessScope).toBe('team');
        expect(confirmed.title).toBe('we keep the queue, with a dead-letter path');
        expect(confirmed.lastVerifiedAt).not.toBeNull();
      });

      await adapter.withScope(SCOPE_B, async (store) => {
        await expect(
          store.confirmContextItem({ id: item.id, confirmedBy: ACTOR_B }),
        ).rejects.toThrow(/found none/);
      });
    });
  });

  it('records the item set behind a handoff, and reads it back with its sections', async () => {
    await withAdapter(async (adapter) => {
      const item = await adapter.withScope(SCOPE_A, async (store) =>
        store.insertContextItem(newItem(PROJECT_A, ACTOR_A, 'No downtime window')),
      );

      const created = await adapter.withScope(SCOPE_A, async (store) =>
        store.createHandoff({
          projectId: PROJECT_A,
          fromActor: ACTOR_A,
          nextAction: 'Wire the retry path to the new idempotency key',
          rendered: '# Handoff: acme',
          items: [{ itemId: item.id, section: 'Constraints (do not violate)' }],
        }),
      );

      await adapter.withScope(SCOPE_A, async (store) => {
        const recorded = await store.listHandoffItems(created.id);
        expect(recorded).toHaveLength(1);
        expect(recorded[0]?.section).toBe('Constraints (do not violate)');
        expect(recorded[0]?.item.id).toBe(item.id);
        expect(recorded[0]?.item.title).toBe('No downtime window');
      });

      await adapter.withScope(SCOPE_B, async (store) => {
        expect(await store.listHandoffItems(created.id)).toHaveLength(0);
      });
    });
  });

  it('refuses arguments that are not UUIDs before they reach SQL', async () => {
    await withAdapter(async (adapter) => {
      await adapter.withScope(SCOPE_A, async (store) => {
        await expect(store.getActor('actor-1')).rejects.toThrow(
          /expected id to be a UUID; received "actor-1"/,
        );
        await expect(store.listContextItems({ projectId: PROJECT_A, limit: 0 })).rejects.toThrow(
          /expected filter.limit to be an integer between 1 and 1000/,
        );
      });

      await expect(
        adapter.withScope({ workspaceId: 'nope', actorId: ACTOR_A }, async () => {}),
      ).rejects.toThrow(/expected scope.workspaceId to be a UUID/);
    });
  });
});
