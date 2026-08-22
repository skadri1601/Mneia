import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { SqlResult, SqlValue } from '../../packages/core/src/index.js';
import { migrate, WORKSPACE_SETTING } from '../../packages/core/src/index.js';
import type {
  PostgresConnectionSource,
  PostgresSession,
  WorkspaceScope,
} from '../../packages/core/src/store/adapter/index.js';
import { PostgresStoreAdapter } from '../../packages/core/src/store/adapter/index.js';
import { APP_ROLE, ensureAppRole, grantSchemaToAppRole } from './app-role.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS_HOME = '1a111111-1111-4111-8111-111111111111';
const WS_OTHER = '1b222222-2222-4222-8222-222222222222';
const HUMAN_HOME = '2a111111-1111-4111-8111-111111111111';
const AGENT_HOME = '2b111111-1111-4111-8111-111111111111';
const HUMAN_OTHER = '2c222222-2222-4222-8222-222222222222';
const TEAM_HOME = '3a111111-1111-4111-8111-111111111111';
const TEAM_OTHER = '3b222222-2222-4222-8222-222222222222';
const PROJECT_HOME = '4a111111-1111-4111-8111-111111111111';
const PROJECT_OTHER = '4b222222-2222-4222-8222-222222222222';

const SCOPE_HUMAN: WorkspaceScope = { workspaceId: WS_HOME, actorId: HUMAN_HOME };
const SCOPE_AGENT: WorkspaceScope = { workspaceId: WS_HOME, actorId: AGENT_HOME };
const SCOPE_OTHER: WorkspaceScope = { workspaceId: WS_OTHER, actorId: HUMAN_OTHER };

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

async function seed(client: Client): Promise<void> {
  const workspaces: readonly (readonly [string, string, string, string, string])[] = [
    [WS_HOME, 'home', HUMAN_HOME, TEAM_HOME, PROJECT_HOME],
    [WS_OTHER, 'other', HUMAN_OTHER, TEAM_OTHER, PROJECT_OTHER],
  ];

  for (const [workspaceId, slug, actorId, teamId, projectId] of workspaces) {
    await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
    await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
      workspaceId,
      slug,
    ]);
    await client.query(
      "INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, 'human', $3)",
      [actorId, workspaceId, `${slug} lead`],
    );
    await client.query(
      'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $3)',
      [teamId, workspaceId, `${slug}-eng`],
    );
    await client.query(
      "INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, 'lead')",
      [workspaceId, teamId, actorId],
    );
    await client.query(
      'INSERT INTO project (id, workspace_id, team_id, slug) VALUES ($1, $2, $3, $4)',
      [projectId, workspaceId, teamId, `${slug}-platform`],
    );
  }

  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS_HOME]);
  await client.query(
    "INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, 'agent', 'home coding agent')",
    [AGENT_HOME, WS_HOME],
  );
  await client.query(
    "INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, 'member')",
    [WS_HOME, TEAM_HOME, AGENT_HOME],
  );
}

async function rawRows(
  client: Client,
  workspaceId: string,
  sql: string,
  params: readonly unknown[] = [],
): Promise<readonly Record<string, unknown>[]> {
  await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
  const result = await client.query(sql, [...params]);
  return result.rows as Record<string, unknown>[];
}

let schemaCounter = 0;

async function withAdapter(
  run: (adapter: PostgresStoreAdapter, setup: Client) => Promise<void>,
): Promise<void> {
  const schema = `mne273_${process.pid}_${++schemaCounter}`;
  const setup = await connect();
  const source = new SchemaConnectionSource(schema);

  try {
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(setup), { appliedBy: 'integration' });
    await ensureAppRole(setup);
    await grantSchemaToAppRole(setup, schema);
    await seed(setup);

    await run(new PostgresStoreAdapter(source), setup);
  } finally {
    await source.close();
    await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await setup.end();
  }
}

describe.skipIf(connectionString === undefined)(
  'the review queue — listPendingReviewItems and reviewPendingItems (MNE-273)',
  () => {
    afterAll(async () => {
      const client = await connect();
      await client.query(
        `DO $$
         DECLARE s TEXT;
         BEGIN
           FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne273_%'
           LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
           END LOOP;
         END $$`,
      );
      await client.end();
    });

    it('refuses a confirmation from an agent-kind scope, reading the kind from actor not the payload', async () => {
      await withAdapter(async (adapter, setup) => {
        const asserted = await adapter.withScope(SCOPE_AGENT, (store) =>
          store.insertContextItem({
            projectId: PROJECT_HOME,
            kind: 'decision',
            title: 'the review route is the loophole §10.1 forbids',
            loadBearing: true,
          }),
        );

        await expect(
          adapter.withScope(SCOPE_AGENT, (store) =>
            store.reviewPendingItems({
              projectId: PROJECT_HOME,
              reviews: [{ itemId: asserted.id, decision: 'accept' }],
            }),
          ),
        ).rejects.toThrow(/to be of kind "human"; received "agent"/);

        const rows = await rawRows(
          setup,
          WS_HOME,
          'SELECT human_confirmed, status FROM context_item WHERE id = $1',
          [asserted.id],
        );
        expect(rows[0]?.human_confirmed).toBe(false);
        expect(rows[0]?.status).toBe('active');

        const stillPending = await adapter.withScope(SCOPE_HUMAN, (store) =>
          store.listPendingReviewItems({ projectId: PROJECT_HOME }),
        );
        expect(stillPending.map((item) => item.id)).toContain(asserted.id);
      });
    });

    it('lets a human confirm, edit, and reject, and reports the outcome each item got', async () => {
      await withAdapter(async (adapter, setup) => {
        const written = await adapter.withScope(SCOPE_AGENT, async (store) => ({
          confirm: await store.insertContextItem({
            projectId: PROJECT_HOME,
            kind: 'fact',
            title: 'the deploy gate fails closed when production is behind',
          }),
          edit: await store.insertContextItem({
            projectId: PROJECT_HOME,
            kind: 'constraint',
            title: 'migrations run before the gate',
          }),
          reject: await store.insertContextItem({
            projectId: PROJECT_HOME,
            kind: 'fact',
            title: 'the droplet holds the model keys',
          }),
        }));

        const result = await adapter.withScope(SCOPE_HUMAN, (store) =>
          store.reviewPendingItems({
            projectId: PROJECT_HOME,
            reviews: [
              { itemId: written.confirm.id, decision: 'accept' },
              {
                itemId: written.edit.id,
                decision: 'accept',
                title: 'migrate, then gate, then deploy',
              },
              { itemId: written.reject.id, decision: 'reject' },
            ],
            summary: '2 accepted, 1 rejected',
          }),
        );

        expect(result.outcomes).toEqual([
          { itemId: written.confirm.id, outcome: 'confirmed', fieldsChanged: [] },
          { itemId: written.edit.id, outcome: 'edited', fieldsChanged: ['title'] },
          { itemId: written.reject.id, outcome: 'rejected', fieldsChanged: [] },
        ]);

        const rows = await rawRows(
          setup,
          WS_HOME,
          'SELECT id, human_confirmed, status FROM context_item WHERE project_id = $1 ORDER BY title',
          [PROJECT_HOME],
        );
        const byId = new Map(rows.map((row) => [row.id as string, row]));
        expect(byId.get(written.confirm.id)?.human_confirmed).toBe(true);
        expect(byId.get(written.edit.id)?.human_confirmed).toBe(true);
        expect(byId.get(written.reject.id)?.status).toBe('retired');

        const drained = await adapter.withScope(SCOPE_HUMAN, (store) =>
          store.listPendingReviewItems({ projectId: PROJECT_HOME }),
        );
        expect(drained).toEqual([]);
      });
    });

    it('never lists a queue item belonging to another workspace', async () => {
      await withAdapter(async (adapter) => {
        const mine = await adapter.withScope(SCOPE_AGENT, (store) =>
          store.insertContextItem({
            projectId: PROJECT_HOME,
            kind: 'fact',
            title: 'workspace isolation is keyed on a session GUC',
          }),
        );
        await adapter.withScope(SCOPE_OTHER, (store) =>
          store.insertContextItem({
            projectId: PROJECT_OTHER,
            kind: 'fact',
            title: 'another tenant asserted this',
          }),
        );

        const queue = await adapter.withScope(SCOPE_HUMAN, (store) =>
          store.listPendingReviewItems({ projectId: PROJECT_HOME }),
        );

        expect(queue.map((item) => item.id)).toEqual([mine.id]);
        expect(queue[0]?.assertedByKind).toBe('agent');
        expect(queue[0]?.assertedByName).toBe('home coding agent');
      });
    });
  },
);
