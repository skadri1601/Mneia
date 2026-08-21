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

const ONE_MINUTE_MS = 60_000;
const ONE_HOUR_MS = 3_600_000;
const ONE_DAY_MS = 86_400_000;

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
  const schema = `mne111_${process.pid}_${++schemaCounter}`;
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

const decaying = (projectId: string, title: string, decayAfter: number) => ({
  projectId,
  kind: 'fact' as const,
  title,
  decayAfter,
});

describe.skipIf(connectionString === undefined)(
  'context_item re-verification — listStaleContextItems and verifyContextItem (MNE-111)',
  () => {
    afterAll(async () => {
      const client = await connect();
      await client.query(
        `DO $$
         DECLARE s TEXT;
         BEGIN
           FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne111_%'
           LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
           END LOOP;
         END $$`,
      );
      await client.end();
    });

    it('lists only the items whose verification has come due, and never a row from another workspace', async () => {
      await withAdapter(async (adapter) => {
        const asOf = new Date(Date.now() + ONE_HOUR_MS);

        const due = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'the staging queue drains on the hour', ONE_MINUTE_MS),
          ),
        );
        const fresh = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'the release train leaves on Thursdays', ONE_DAY_MS),
          ),
        );
        const undecaying = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.insertContextItem({
            projectId: PROJECT_HOME,
            kind: 'constraint',
            title: 'no content in telemetry events',
            loadBearing: true,
          }),
        );
        const foreign = await adapter.withScope(SCOPE_OTHER, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_OTHER, 'other workspace pins node 22', ONE_MINUTE_MS),
          ),
        );

        await adapter.withScope(SCOPE_HUMAN, async (store) => {
          const stale = await store.listStaleContextItems({ projectId: PROJECT_HOME, asOf });
          const ids = stale.map((entry) => entry.item.id);

          expect(ids).toEqual([due.id]);
          expect(ids).not.toContain(fresh.id);
          expect(ids).not.toContain(undecaying.id);
          expect(ids).not.toContain(foreign.id);

          const crossWorkspace = await store.listStaleContextItems({
            projectId: PROJECT_OTHER,
            asOf,
          });
          expect(crossWorkspace).toEqual([]);
        });

        await adapter.withScope(SCOPE_OTHER, async (store) => {
          const stale = await store.listStaleContextItems({ projectId: PROJECT_OTHER, asOf });
          expect(stale.map((entry) => entry.item.id)).toEqual([foreign.id]);
          expect(stale.every((entry) => entry.item.workspaceId === WS_OTHER)).toBe(true);
        });
      });
    });

    it('anchors staleness on asserted_at until a verification moves it to last_verified_at', async () => {
      await withAdapter(async (adapter) => {
        const item = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'the nightly export lands before 06:00', ONE_MINUTE_MS),
          ),
        );
        const asOf = new Date(item.assertedAt.getTime() + ONE_HOUR_MS);

        await adapter.withScope(SCOPE_HUMAN, async (store) => {
          const stale = await store.listStaleContextItems({ projectId: PROJECT_HOME, asOf });
          const entry = stale[0];
          if (entry === undefined) {
            throw new Error('expected the decayed item to be listed as stale; it was not');
          }

          expect(entry.item.id).toBe(item.id);
          expect(entry.staleSince.getTime()).toBe(item.assertedAt.getTime() + ONE_MINUTE_MS);
          expect(entry.staleForMs).toBe(asOf.getTime() - entry.staleSince.getTime());
        });

        const verified = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.verifyContextItem({
            projectId: PROJECT_HOME,
            itemId: item.id,
            verification: 'confirmed',
          }),
        );

        const lastVerifiedAt = verified.item.lastVerifiedAt;
        if (lastVerifiedAt === null) {
          throw new Error('expected the confirmation to set last_verified_at; it stayed null');
        }
        expect(lastVerifiedAt.getTime()).toBeGreaterThan(item.assertedAt.getTime());

        await adapter.withScope(SCOPE_HUMAN, async (store) => {
          const notYetDue = await store.listStaleContextItems({
            projectId: PROJECT_HOME,
            asOf: new Date(lastVerifiedAt.getTime() + 1_000),
          });
          expect(notYetDue.map((entry) => entry.item.id)).toEqual([]);

          const dueAgain = await store.listStaleContextItems({
            projectId: PROJECT_HOME,
            asOf: new Date(lastVerifiedAt.getTime() + ONE_HOUR_MS),
          });
          const entry = dueAgain[0];
          if (entry === undefined) {
            throw new Error('expected the item to come due again an hour later; it did not');
          }
          expect(entry.staleSince.getTime()).toBe(lastVerifiedAt.getTime() + ONE_MINUTE_MS);
          expect(entry.staleSince.getTime()).toBeGreaterThan(
            item.assertedAt.getTime() + ONE_MINUTE_MS,
          );
        });
      });
    });

    it('reads the verifying actor kind from the actor table, not from the caller', async () => {
      await withAdapter(async (adapter, setup) => {
        const item = await adapter.withScope(SCOPE_AGENT, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'the extractor batches at 200 turns', ONE_MINUTE_MS),
          ),
        );

        expect(item.assertedBy).toBe(AGENT_HOME);
        expect(item.humanConfirmed).toBe(false);

        await adapter.withScope(SCOPE_AGENT, async (store) => {
          await expect(
            store.verifyContextItem({
              projectId: PROJECT_HOME,
              itemId: item.id,
              verification: 'confirmed',
            }),
          ).rejects.toThrow(/to be of kind "human"; received "agent"/);
        });

        const untouched = await rawRows(
          setup,
          WS_HOME,
          'SELECT human_confirmed, last_verified_at FROM context_item WHERE id = $1',
          [item.id],
        );
        expect(untouched[0]?.human_confirmed).toBe(false);
        expect(untouched[0]?.last_verified_at).toBeNull();

        await rawRows(setup, WS_HOME, "UPDATE actor SET kind = 'human' WHERE id = $1", [
          AGENT_HOME,
        ]);

        const result = await adapter.withScope(SCOPE_AGENT, async (store) =>
          store.verifyContextItem({
            projectId: PROJECT_HOME,
            itemId: item.id,
            verification: 'confirmed',
          }),
        );

        expect(result.item.humanConfirmed).toBe(true);
        expect(result.item.assertedBy).toBe(AGENT_HOME);
      });
    });

    it('derives human_confirmed from the verifier and leaves asserted_by where it was', async () => {
      await withAdapter(async (adapter) => {
        const item = await adapter.withScope(SCOPE_AGENT, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'rehydrate holds a 300ms p95 budget', ONE_MINUTE_MS),
          ),
        );

        const result = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.verifyContextItem({
            projectId: PROJECT_HOME,
            itemId: item.id,
            verification: 'confirmed',
            reason: 'still true after the M1 rewrite',
          }),
        );

        expect(result.item.assertedBy).toBe(AGENT_HOME);
        expect(result.item.humanConfirmed).toBe(true);
        expect(result.checkpoint.actorId).toBe(HUMAN_HOME);
      });
    });

    it('records a confirmation as a checkpoint outcome and refreshes last_verified_at', async () => {
      await withAdapter(async (adapter, setup) => {
        const item = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'the CLI reads MNEIA_HOME for credentials', ONE_MINUTE_MS),
          ),
        );

        expect(item.lastVerifiedAt).toBeNull();

        const first = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.verifyContextItem({
            projectId: PROJECT_HOME,
            itemId: item.id,
            verification: 'confirmed',
            reason: 'checked against the running binary',
          }),
        );

        expect(first.verification).toBe('confirmed');
        expect(first.previousLastVerifiedAt).toBeNull();
        expect(first.item.status).toBe('active');
        expect(first.item.validTo).toBeNull();

        const refreshed = first.item.lastVerifiedAt;
        if (refreshed === null) {
          throw new Error('expected the confirmation to set last_verified_at; it stayed null');
        }
        expect(refreshed.getTime()).toBeGreaterThanOrEqual(item.assertedAt.getTime());

        const outcome = await rawRows(
          setup,
          WS_HOME,
          `SELECT checkpoint_item.action, checkpoint."trigger", checkpoint.summary, checkpoint.session_id
             FROM checkpoint_item
             JOIN checkpoint ON checkpoint.id = checkpoint_item.checkpoint_id
            WHERE checkpoint_item.item_id = $1`,
          [item.id],
        );

        expect(outcome).toHaveLength(1);
        expect(outcome[0]?.action).toBe('updated');
        expect(outcome[0]?.trigger).toBe('manual');
        expect(outcome[0]?.summary).toBe('Re-verified: checked against the running binary');
        expect(outcome[0]?.session_id).toBeNull();

        const second = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.verifyContextItem({
            projectId: PROJECT_HOME,
            itemId: item.id,
            verification: 'confirmed',
          }),
        );

        expect(second.previousLastVerifiedAt?.getTime()).toBe(refreshed.getTime());
      });
    });

    it('retires the item on a denial, and refuses a denial that carries no reason', async () => {
      await withAdapter(async (adapter, setup) => {
        const item = await adapter.withScope(SCOPE_AGENT, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'the waitlist mails from Resend', ONE_MINUTE_MS),
          ),
        );
        const asOf = new Date(item.assertedAt.getTime() + ONE_HOUR_MS);

        expect(item.humanConfirmed).toBe(false);

        await adapter.withScope(SCOPE_HUMAN, async (store) => {
          await expect(
            store.verifyContextItem({
              projectId: PROJECT_HOME,
              itemId: item.id,
              verification: 'denied',
            }),
          ).rejects.toThrow(/expected input.reason to say why the item no longer holds/);
        });

        const stillActive = await rawRows(
          setup,
          WS_HOME,
          'SELECT status FROM context_item WHERE id = $1',
          [item.id],
        );
        expect(stillActive[0]?.status).toBe('active');

        const denial = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.verifyContextItem({
            projectId: PROJECT_HOME,
            itemId: item.id,
            verification: 'denied',
            reason: 'we moved to Postmark in July',
          }),
        );

        expect(denial.verification).toBe('denied');
        expect(denial.item.status).toBe('retired');
        expect(denial.item.validTo).not.toBeNull();
        expect(denial.item.humanConfirmed).toBe(false);

        const outcome = await rawRows(
          setup,
          WS_HOME,
          `SELECT checkpoint_item.action, checkpoint.summary
             FROM checkpoint_item
             JOIN checkpoint ON checkpoint.id = checkpoint_item.checkpoint_id
            WHERE checkpoint_item.item_id = $1`,
          [item.id],
        );
        expect(outcome).toHaveLength(1);
        expect(outcome[0]?.action).toBe('rejected');
        expect(outcome[0]?.summary).toBe('Verification denied: we moved to Postmark in July');

        await adapter.withScope(SCOPE_HUMAN, async (store) => {
          const stale = await store.listStaleContextItems({ projectId: PROJECT_HOME, asOf });
          expect(stale.map((entry) => entry.item.id)).toEqual([]);

          await expect(
            store.verifyContextItem({
              projectId: PROJECT_HOME,
              itemId: item.id,
              verification: 'confirmed',
            }),
          ).rejects.toThrow(/its status is "retired"/);
        });
      });
    });

    it('refuses to verify an item that belongs to another workspace', async () => {
      await withAdapter(async (adapter, setup) => {
        const item = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.insertContextItem(
            decaying(
              PROJECT_HOME,
              'the droplet holds everything but the model keys',
              ONE_MINUTE_MS,
            ),
          ),
        );

        await adapter.withScope(SCOPE_OTHER, async (store) => {
          await expect(
            store.verifyContextItem({
              projectId: PROJECT_HOME,
              itemId: item.id,
              verification: 'confirmed',
            }),
          ).rejects.toThrow(/found none/);
        });

        const untouched = await rawRows(
          setup,
          WS_HOME,
          'SELECT human_confirmed, last_verified_at, status FROM context_item WHERE id = $1',
          [item.id],
        );
        expect(untouched[0]?.human_confirmed).toBe(true);
        expect(untouched[0]?.last_verified_at).toBeNull();
        expect(untouched[0]?.status).toBe('active');

        const leaked = await rawRows(
          setup,
          WS_OTHER,
          'SELECT count(*)::int AS n FROM checkpoint WHERE workspace_id = $1',
          [WS_OTHER],
        );
        expect(leaked[0]?.n).toBe(0);
      });
    });

    it('refuses a verification naming a project the item does not belong to', async () => {
      await withAdapter(async (adapter) => {
        const item = await adapter.withScope(SCOPE_HUMAN, async (store) =>
          store.insertContextItem(
            decaying(PROJECT_HOME, 'migrations run before the deploy gate', ONE_MINUTE_MS),
          ),
        );

        await adapter.withScope(SCOPE_HUMAN, async (store) => {
          await expect(
            store.verifyContextItem({
              projectId: PROJECT_OTHER,
              itemId: item.id,
              verification: 'confirmed',
            }),
          ).rejects.toThrow(/found none/);
        });
      });
    });
  },
);
