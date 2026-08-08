import { Client } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  handleListItems,
  handleRehydrate,
  handleWriteCheckpoint,
} from '../../apps/web/src/server/api/handlers.js';
import type {
  PostgresConnectionSource,
  PostgresSession,
  SqlResult,
  SqlValue,
  TelemetryEmitter,
  TelemetryEvent,
  WorkspaceScope,
} from '../../packages/core/src/index.js';
import {
  migrate,
  PostgresStoreAdapter,
  SupersedeNotAllowedError,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import { APP_ROLE, ensureAppRole, grantSchemaToAppRole } from './app-role.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS_A = '11111111-1111-4111-8111-1111111111a1';
const WS_B = '11111111-1111-4111-8111-1111111111b1';
const HUMAN_A = '22222222-2222-4222-8222-2222222222a1';
const AGENT_A = '22222222-2222-4222-8222-2222222222a2';
const HUMAN_B = '22222222-2222-4222-8222-2222222222b1';
const TEAM_A = '33333333-3333-4333-8333-3333333333a1';
const TEAM_B = '33333333-3333-4333-8333-3333333333b1';
const PROJECT_A = '44444444-4444-4444-8444-4444444444a1';
const PROJECT_B = '44444444-4444-4444-8444-4444444444b1';
const OUTSIDER = '55555555-5555-4555-8555-555555555501';

const SCOPE_AGENT_A: WorkspaceScope = { workspaceId: WS_A, actorId: AGENT_A };
const SCOPE_HUMAN_A: WorkspaceScope = { workspaceId: WS_A, actorId: HUMAN_A };
const SCOPE_HUMAN_B: WorkspaceScope = { workspaceId: WS_B, actorId: HUMAN_B };

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

  constructor(private readonly schema: string) {}

  async acquire(): Promise<PostgresSession> {
    const client = await connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    await client.query(`SET ROLE ${APP_ROLE}`);
    this.clients.push(client);
    return new SchemaSession(client);
  }

  async close(): Promise<void> {
    const open = this.clients.splice(0, this.clients.length);
    for (const client of open) {
      await client.end();
    }
  }
}

const recorder = (): { telemetry: TelemetryEmitter; events: TelemetryEvent[] } => {
  const events: TelemetryEvent[] = [];
  const telemetry = {
    emit: async (event: TelemetryEvent) => {
      events.push(event);
    },
  } as unknown as TelemetryEmitter;
  return { telemetry, events };
};

const deps = (telemetry: TelemetryEmitter) => ({
  telemetry,
  now: () => new Date(),
  monotonicMs: () => performance.now(),
});

async function seed(client: Client): Promise<void> {
  const workspaces = [
    [WS_A, 'acme', HUMAN_A, TEAM_A, PROJECT_A],
    [WS_B, 'globex', HUMAN_B, TEAM_B, PROJECT_B],
  ] as const;

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

let schemaCounter = 0;

async function withAdapter(run: (adapter: PostgresStoreAdapter) => Promise<void>): Promise<void> {
  const schema = `mne101_${process.pid}_${++schemaCounter}`;
  const setup = await connect();
  const source = new SchemaConnectionSource(schema);

  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(setup), { appliedBy: 'integration' });
    await ensureAppRole(setup);
    await grantSchemaToAppRole(setup, schema);
    await seed(setup);

    await run(new PostgresStoreAdapter(source));
  } finally {
    await source.close();
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setup.end();
  }
}

const checkpointOf = (title: string, extra: Record<string, unknown> = {}) => ({
  checkpoint: {
    projectId: PROJECT_A,
    sessionId: null,
    trigger: 'manual' as const,
    summary: null,
  },
  items: [
    {
      action: 'created' as const,
      item: { projectId: PROJECT_A, kind: 'decision' as const, title, ...extra },
    },
  ],
});

describe.skipIf(connectionString === undefined)('hosted API handlers', () => {
  it('records the token actor as the author, whatever the payload claims', async () => {
    await withAdapter(async (adapter) => {
      const { telemetry } = recorder();

      const { result } = await adapter.withScope(SCOPE_AGENT_A, (store) =>
        handleWriteCheckpoint(
          store,
          checkpointOf('ship the hosted API', {
            assertedBy: OUTSIDER,
            humanConfirmed: true,
          }) as never,
          deps(telemetry),
        ),
      );

      const written = result.written.at(0);
      expect(written?.assertedBy).toBe(AGENT_A);
      expect(written?.humanConfirmed).toBe(false);
      expect(result.checkpoint.actorId).toBe(AGENT_A);
    });
  });

  it('records a human actor as human-confirmed', async () => {
    await withAdapter(async (adapter) => {
      const { telemetry } = recorder();

      const { result } = await adapter.withScope(SCOPE_HUMAN_A, (store) =>
        handleWriteCheckpoint(store, checkpointOf('the founder decided') as never, deps(telemetry)),
      );

      expect(result.written.at(0)?.humanConfirmed).toBe(true);
      expect(result.written.at(0)?.assertedBy).toBe(HUMAN_A);
    });
  });

  it('refuses to let an agent supersede a human-confirmed item through the API', async () => {
    await withAdapter(async (adapter) => {
      const { telemetry } = recorder();

      const { result } = await adapter.withScope(SCOPE_HUMAN_A, (store) =>
        handleWriteCheckpoint(
          store,
          checkpointOf('postgres is the only engine') as never,
          deps(telemetry),
        ),
      );
      const humanItem = result.written.at(0);
      expect(humanItem?.humanConfirmed).toBe(true);

      await expect(
        adapter.withScope(SCOPE_AGENT_A, (store) =>
          handleWriteCheckpoint(
            store,
            checkpointOf('actually use sqlite', { supersedesId: humanItem?.id }) as never,
            deps(telemetry),
          ),
        ),
      ).rejects.toBeInstanceOf(SupersedeNotAllowedError);

      const after = await adapter.withScope(SCOPE_HUMAN_A, (store) =>
        handleListItems(store, { projectId: PROJECT_A }),
      );
      expect(after.items.map((item) => item.title)).toEqual(['postgres is the only engine']);
    });
  });

  it('keeps a load-bearing constraint in the slice at the smallest budget', async () => {
    await withAdapter(async (adapter) => {
      const { telemetry, events } = recorder();

      await adapter.withScope(SCOPE_HUMAN_A, async (store) => {
        await handleWriteCheckpoint(
          store,
          {
            checkpoint: {
              projectId: PROJECT_A,
              sessionId: null,
              trigger: 'manual' as const,
              summary: null,
            },
            items: [
              {
                action: 'created' as const,
                item: {
                  projectId: PROJECT_A,
                  kind: 'constraint' as const,
                  title: 'never auto-supersede a human-confirmed item',
                  loadBearing: true,
                },
              },
              ...Array.from({ length: 12 }, (_, index) => ({
                action: 'created' as const,
                item: {
                  projectId: PROJECT_A,
                  kind: 'fact' as const,
                  title: `padding fact number ${index} that exists only to crowd the budget`,
                },
              })),
            ],
          } as never,
          deps(telemetry),
        );
      });

      const { slice } = await adapter.withScope(SCOPE_HUMAN_A, (store) =>
        handleRehydrate(
          store,
          { project: 'acme-platform', task: 'pick a storage engine', tokenBudget: 500 },
          deps(telemetry),
        ),
      );

      expect(slice.items.map((scored) => scored.item.title)).toContain(
        'never auto-supersede a human-confirmed item',
      );
      expect(events.some((event) => event.name === 'rehydration.slice_shown')).toBe(true);
    });
  });

  it('lets no caller of the store itself claim provenance, with no API in the path', async () => {
    await withAdapter(async (adapter) => {
      const written = await adapter.withScope(SCOPE_AGENT_A, (store) =>
        store.insertContextItem({
          projectId: PROJECT_A,
          kind: 'decision',
          title: 'written straight through the store',
          assertedBy: OUTSIDER,
          humanConfirmed: true,
        } as never),
      );

      expect(written.assertedBy).toBe(AGENT_A);
      expect(written.assertedBy).not.toBe(OUTSIDER);
      expect(written.humanConfirmed).toBe(false);
    });
  });

  it('does not carry the embedding on a read that never asked for one', async () => {
    await withAdapter(async (adapter) => {
      const { telemetry } = recorder();

      await adapter.withScope(SCOPE_HUMAN_A, (store) =>
        handleWriteCheckpoint(
          store,
          checkpointOf('an item with no vector') as never,
          deps(telemetry),
        ),
      );

      const [withoutEmbedding, withEmbedding] = await adapter.withScope(
        SCOPE_HUMAN_A,
        async (store) =>
          [
            await store.listContextItems({ projectId: PROJECT_A }),
            await store.listContextItems({ projectId: PROJECT_A, withEmbedding: true }),
          ] as const,
      );

      expect(withoutEmbedding).toHaveLength(1);
      expect(withEmbedding).toHaveLength(1);
      expect(withoutEmbedding.at(0)?.embedding).toBeNull();
      expect(withEmbedding.at(0)?.embedding).toBeNull();
    });
  });

  it('shows a workspace nothing that belongs to another workspace', async () => {
    await withAdapter(async (adapter) => {
      const { telemetry } = recorder();

      await adapter.withScope(SCOPE_HUMAN_A, (store) =>
        handleWriteCheckpoint(store, checkpointOf('acme only') as never, deps(telemetry)),
      );

      const mine = await adapter.withScope(SCOPE_HUMAN_A, (store) =>
        handleListItems(store, { projectId: PROJECT_A }),
      );
      expect(mine.items).toHaveLength(1);

      const theirs = await adapter.withScope(SCOPE_HUMAN_B, (store) =>
        handleListItems(store, { projectId: PROJECT_A }),
      );
      expect(theirs.items).toHaveLength(0);
    });
  });
});
