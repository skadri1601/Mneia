import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

import {
  handleCreateProject,
  handleGetProjectBySlug,
} from '../../apps/web/src/server/api/handlers.js';
import { listProjects, ProjectControlError } from '../../apps/web/src/server/projects.js';
import type { AccountContext } from '../../apps/web/src/server/store/account-store.js';
import { PostgresProjectStore } from '../../apps/web/src/server/store/postgres-project-store.js';
import type {
  PostgresConnectionSource,
  PostgresSession,
  SqlResult,
  SqlValue,
  WorkspaceScope,
} from '../../packages/core/src/index.js';
import { migrate, PostgresStoreAdapter, WORKSPACE_SETTING } from '../../packages/core/src/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;
const runId = `${process.pid}_${Date.now()}`;
const tenantRole = `mne271_journey_${runId}`;
const schemaPrefix = `mne271_${runId}`;

const WORKSPACE_A = '11111111-1111-4111-8111-1111111111a1';
const WORKSPACE_B = '11111111-1111-4111-8111-1111111111b1';
const LEAD_A = '22222222-2222-4222-8222-2222222222a1';
const SECOND_A = '22222222-2222-4222-8222-2222222222a2';
const LEAD_B = '22222222-2222-4222-8222-2222222222b1';
const TEAM_A = '33333333-3333-4333-8333-3333333333a1';
const TEAM_B = '33333333-3333-4333-8333-3333333333b1';
const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');

const REPO_SLUG = 'checkout';

const SCOPE_LEAD_A: WorkspaceScope = { workspaceId: WORKSPACE_A, actorId: LEAD_A };
const SCOPE_SECOND_A: WorkspaceScope = { workspaceId: WORKSPACE_A, actorId: SECOND_A };
const SCOPE_LEAD_B: WorkspaceScope = { workspaceId: WORKSPACE_B, actorId: LEAD_B };

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

class RoleSession implements PostgresSession {
  private released = false;

  constructor(
    private readonly client: Client,
    private readonly forget: (client: Client) => void,
  ) {}

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

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    this.forget(this.client);
    await this.client.end();
  }

  async discard(): Promise<void> {
    await this.release();
  }
}

class RoleConnectionSource implements PostgresConnectionSource {
  private readonly clients = new Set<Client>();

  constructor(private readonly schema: string) {}

  async acquire(): Promise<PostgresSession> {
    const client = await connect();
    await client.query(`SET search_path TO "${this.schema}", public`);
    await client.query(`SET ROLE ${tenantRole}`);
    this.clients.add(client);
    return new RoleSession(client, (released) => this.clients.delete(released));
  }

  async close(): Promise<void> {
    const open = [...this.clients];
    this.clients.clear();
    for (const client of open) {
      await client.end();
    }
  }
}

const account = (
  workspaceId: string,
  actorId: string,
  teamId: string,
  workspaceSlug: string,
): AccountContext => ({
  workspace: {
    id: workspaceId,
    slug: workspaceSlug,
    displayName: workspaceSlug,
    plan: 'solo',
    billingStatus: 'active',
    billingCustomerRef: null,
    seatsPurchased: null,
    checkpointAllowance: null,
    trialEndsAt: null,
    createdAt: CREATED_AT,
  },
  actor: {
    id: actorId,
    workspaceId,
    kind: 'human',
    displayName: `${workspaceSlug} member`,
    externalRef: null,
    createdAt: CREATED_AT,
  },
  team: {
    id: teamId,
    workspaceId,
    slug: 'default',
    displayName: 'Default',
    function: 'engineering',
    createdAt: CREATED_AT,
  },
  membership: { workspaceId, teamId, actorId, role: 'lead', addedAt: CREATED_AT },
});

const ACCOUNT_LEAD_A = account(WORKSPACE_A, LEAD_A, TEAM_A, 'acme');
const ACCOUNT_SECOND_A = account(WORKSPACE_A, SECOND_A, TEAM_A, 'acme');
const ACCOUNT_LEAD_B = account(WORKSPACE_B, LEAD_B, TEAM_B, 'globex');

async function seed(admin: Client): Promise<void> {
  for (const [workspaceId, workspaceSlug, actorId, teamId] of [
    [WORKSPACE_A, 'acme', LEAD_A, TEAM_A],
    [WORKSPACE_B, 'globex', LEAD_B, TEAM_B],
  ] as const) {
    await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, workspaceId]);
    await admin.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
      workspaceId,
      workspaceSlug,
    ]);
    await admin.query(
      `INSERT INTO actor (id, workspace_id, kind, display_name)
       VALUES ($1, $2, 'human', $3)`,
      [actorId, workspaceId, `${workspaceSlug} lead`],
    );
    await admin.query(
      `INSERT INTO team (id, workspace_id, slug, display_name)
       VALUES ($1, $2, 'default', 'Default')`,
      [teamId, workspaceId],
    );
    await admin.query(
      `INSERT INTO team_member (workspace_id, team_id, actor_id, role)
       VALUES ($1, $2, $3, 'lead')`,
      [workspaceId, teamId, actorId],
    );
  }

  await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE_A]);
  await admin.query(
    `INSERT INTO actor (id, workspace_id, kind, display_name)
     VALUES ($1, $2, 'human', 'acme second engineer')`,
    [SECOND_A, WORKSPACE_A],
  );
  await admin.query(
    `INSERT INTO team_member (workspace_id, team_id, actor_id, role)
     VALUES ($1, $2, $3, 'member')`,
    [WORKSPACE_A, TEAM_A, SECOND_A],
  );
}

interface JourneyFixture {
  readonly adapter: PostgresStoreAdapter;
  readonly projects: PostgresProjectStore;
}

let schemaCounter = 0;

async function withJourney(run: (fixture: JourneyFixture) => Promise<void>): Promise<void> {
  const schema = `${schemaPrefix}_${++schemaCounter}`;
  const admin = await connect();
  const source = new RoleConnectionSource(schema);

  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(admin), { appliedBy: 'integration' });
    await admin.query(`GRANT USAGE ON SCHEMA "${schema}" TO ${tenantRole}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${tenantRole}`,
    );
    await seed(admin);

    await run({
      adapter: new PostgresStoreAdapter(source),
      projects: new PostgresProjectStore(source),
    });
  } finally {
    await source.close();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
}

const runInit = (adapter: PostgresStoreAdapter, scope: WorkspaceScope, slug: string) =>
  adapter.withScope(scope, (store) =>
    handleCreateProject(store, { slug, displayName: 'Checkout', repoUrl: null }),
  );

const slugsVisibleTo = async (
  projects: PostgresProjectStore,
  who: AccountContext,
): Promise<readonly string[]> =>
  (await listProjects({ account: who, includeArchived: false, store: projects })).map(
    (project) => project.slug,
  );

describe.skipIf(connectionString === undefined)(
  'the project a customer creates with mneia init',
  () => {
    beforeAll(async () => {
      const admin = await connect();
      await admin.query(
        `CREATE ROLE ${tenantRole}
         NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION`,
      );
      await admin.query(`GRANT ${tenantRole} TO CURRENT_USER`);
      await admin.end();
    });

    afterAll(async () => {
      const admin = await connect();
      await admin.query(
        `DO $$
         DECLARE schema_name TEXT;
         BEGIN
           FOR schema_name IN
             SELECT nspname FROM pg_namespace WHERE starts_with(nspname, '${schemaPrefix}_')
           LOOP
             EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
           END LOOP;
         END $$`,
      );
      await admin.query(`DROP ROLE IF EXISTS ${tenantRole}`);
      await admin.end();
    });

    it('lands in the workspace the token belongs to, with an id the CLI can write to its config', async () => {
      await withJourney(async ({ adapter }) => {
        const result = await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);

        expect(result.created).toBe(true);
        expect(result.project.slug).toBe(REPO_SLUG);
        expect(result.project.workspaceId).toBe(WORKSPACE_A);
        expect(result.project.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
      });
    });

    it('attaches to the same project when init runs twice, rather than failing or duplicating', async () => {
      await withJourney(async ({ adapter, projects }) => {
        const first = await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);
        const second = await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);

        expect(first.created).toBe(true);
        expect(second.created).toBe(false);
        expect(second.project.id).toBe(first.project.id);
        expect(await slugsVisibleTo(projects, ACCOUNT_LEAD_A)).toEqual([REPO_SLUG]);
      });
    });

    it('appears in the web app for the account that created it', async () => {
      await withJourney(async ({ adapter, projects }) => {
        const created = await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);

        const listed = await listProjects({
          account: ACCOUNT_LEAD_A,
          includeArchived: false,
          store: projects,
        });

        expect(listed.map((project) => project.id)).toContain(created.project.id);
        expect(listed.map((project) => project.displayName)).toContain('Checkout');
      });
    });

    it('is visible to a second member of the same workspace through the client API', async () => {
      await withJourney(async ({ adapter }) => {
        const created = await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);

        const throughTheApi = await adapter.withScope(SCOPE_SECOND_A, (store) =>
          handleGetProjectBySlug(store, REPO_SLUG),
        );

        expect(throughTheApi.project?.id).toBe(created.project.id);
        expect(throughTheApi.project?.workspaceId).toBe(WORKSPACE_A);
      });
    });

    it('is refused to that same member by the web control plane, which is lead-only', async () => {
      await withJourney(async ({ adapter, projects }) => {
        await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);

        const refusal = await slugsVisibleTo(projects, ACCOUNT_SECOND_A).then(
          () => null,
          (cause: unknown) => cause,
        );

        expect(refusal).toBeInstanceOf(ProjectControlError);
        expect((refusal as ProjectControlError).code).toBe('forbidden');
      });
    });

    it('is invisible to a member of a different workspace, by both routes', async () => {
      await withJourney(async ({ adapter, projects }) => {
        await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);

        expect(await slugsVisibleTo(projects, ACCOUNT_LEAD_B)).not.toContain(REPO_SLUG);

        const throughTheApi = await adapter.withScope(SCOPE_LEAD_B, (store) =>
          handleGetProjectBySlug(store, REPO_SLUG),
        );
        expect(throughTheApi.project).toBeNull();
      });
    });

    it('lets a different workspace hold the same slug without colliding', async () => {
      await withJourney(async ({ adapter, projects }) => {
        const acme = await runInit(adapter, SCOPE_LEAD_A, REPO_SLUG);
        const globex = await runInit(adapter, SCOPE_LEAD_B, REPO_SLUG);

        expect(globex.created).toBe(true);
        expect(globex.project.id).not.toBe(acme.project.id);
        expect(globex.project.workspaceId).toBe(WORKSPACE_B);

        expect(await slugsVisibleTo(projects, ACCOUNT_LEAD_A)).toEqual([REPO_SLUG]);
        expect(await slugsVisibleTo(projects, ACCOUNT_LEAD_B)).toEqual([REPO_SLUG]);
      });
    });
  },
);
