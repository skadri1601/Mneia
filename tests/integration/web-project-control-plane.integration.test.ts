import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../apps/web/node_modules/server-only/index.js', () => ({}));

import type { AccountContext } from '../../apps/web/src/server/store/account-store.js';
import { PostgresProjectStore } from '../../apps/web/src/server/store/postgres-project-store.js';
import {
  migrate,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlResult,
  type SqlValue,
  WORKSPACE_SETTING,
} from '../../packages/core/src/index.js';
import { PostgresStoreAdapter } from '../../packages/core/src/store/adapter/index.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;
const runId = `${process.pid}_${Date.now()}`;
const tenantRole = `mne206_projects_${runId}`;
const schemaPrefix = `mne206_${runId}`;

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEAM_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TEAM_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROJECT_A = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ARCHIVED_PROJECT_A = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const PROJECT_B = '12345678-1234-4234-8234-123456789abc';
const MISSING_PROJECT = '87654321-4321-4321-8321-cba987654321';
const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');

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

interface ProjectFixture {
  readonly admin: Client;
  readonly source: RoleConnectionSource;
  readonly store: PostgresProjectStore;
}

let schemaCounter = 0;

async function withProjectSchema(run: (fixture: ProjectFixture) => Promise<void>): Promise<void> {
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
    await run({ admin, source, store: new PostgresProjectStore(source) });
  } finally {
    await source.close();
    await admin.query('SET search_path TO public');
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
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
    displayName: `${workspaceSlug} lead`,
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
  membership: {
    workspaceId,
    teamId,
    actorId,
    role: 'lead',
    addedAt: CREATED_AT,
  },
});

const ACCOUNT_A = account(WORKSPACE_A, ACTOR_A, TEAM_A, 'acme');
const ACCOUNT_B = account(WORKSPACE_B, ACTOR_B, TEAM_B, 'globex');

async function seed(admin: Client): Promise<void> {
  for (const [workspaceId, workspaceSlug, actorId, teamId] of [
    [WORKSPACE_A, 'acme', ACTOR_A, TEAM_A],
    [WORKSPACE_B, 'globex', ACTOR_B, TEAM_B],
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
    `INSERT INTO project (id, workspace_id, team_id, slug)
     VALUES ($1, $2, $3, 'acme-platform'),
            ($4, $2, $3, 'acme-archive')`,
    [PROJECT_A, WORKSPACE_A, TEAM_A, ARCHIVED_PROJECT_A],
  );
  await admin.query('UPDATE project SET archived_at = now() WHERE id = $1', [ARCHIVED_PROJECT_A]);

  await admin.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WORKSPACE_B]);
  await admin.query(
    `INSERT INTO project (id, workspace_id, team_id, slug)
     VALUES ($1, $2, $3, 'globex-platform')`,
    [PROJECT_B, WORKSPACE_B, TEAM_B],
  );
}

const publicFailure = async (operation: Promise<unknown>): Promise<unknown> => {
  try {
    await operation;
  } catch (error) {
    return error;
  }
  throw new Error('expected the project operation to fail');
};

describe.skipIf(connectionString === undefined)(
  'web project control plane against Postgres',
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

    it('defaults legacy project display names from their immutable slugs', async () => {
      await withProjectSchema(async ({ admin }) => {
        const result = await admin.query<{ display_name: string; slug: string }>(
          'SELECT slug, display_name FROM project WHERE id = $1',
          [PROJECT_A],
        );

        expect(result.rows).toEqual([{ slug: 'acme-platform', display_name: 'acme-platform' }]);
      });
    });

    it('lists active projects separately and includes archived projects on request', async () => {
      await withProjectSchema(async ({ store }) => {
        await expect(store.listProjects(ACCOUNT_A, { includeArchived: false })).resolves.toEqual([
          expect.objectContaining({
            id: PROJECT_A,
            slug: 'acme-platform',
            displayName: 'acme-platform',
            archivedAt: null,
          }),
        ]);

        const all = await store.listProjects(ACCOUNT_A, { includeArchived: true });
        expect(all.map(({ id }) => id)).toEqual([ARCHIVED_PROJECT_A, PROJECT_A]);
        expect(all[0]?.archivedAt).toBeInstanceOf(Date);
      });
    });

    it('creates a project with a generated id, because the column has no default', async () => {
      await withProjectSchema(async ({ store }) => {
        const created = await store.createProject(ACCOUNT_A, {
          slug: 'ledger',
          displayName: 'Ledger',
        });

        expect(created.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        expect(created).toEqual(
          expect.objectContaining({
            workspaceId: ACCOUNT_A.workspace.id,
            slug: 'ledger',
            displayName: 'Ledger',
            teamId: null,
            archivedAt: null,
          }),
        );

        const listed = await store.listProjects(ACCOUNT_A, { includeArchived: false });
        expect(listed.map((project) => project.slug)).toContain('ledger');
      });
    });

    it('refuses a slug already taken in the workspace rather than silently returning nothing', async () => {
      await withProjectSchema(async ({ store }) => {
        await store.createProject(ACCOUNT_A, { slug: 'ledger', displayName: 'Ledger' });

        await expect(
          store.createProject(ACCOUNT_A, { slug: 'ledger', displayName: 'Ledger Again' }),
        ).rejects.toMatchObject({ code: 'slug_taken' });
      });
    });

    it('renames only the display name and archives idempotently', async () => {
      await withProjectSchema(async ({ store }) => {
        const renamed = await store.renameProject(ACCOUNT_A, {
          projectId: PROJECT_A,
          displayName: 'Acme Platform',
        });
        expect(renamed).toEqual(
          expect.objectContaining({
            id: PROJECT_A,
            slug: 'acme-platform',
            displayName: 'Acme Platform',
            archivedAt: null,
          }),
        );

        const archived = await store.archiveProject(ACCOUNT_A, {
          projectId: PROJECT_A,
          expectedSlug: 'acme-platform',
        });
        const archivedAgain = await store.archiveProject(ACCOUNT_A, {
          projectId: PROJECT_A,
          expectedSlug: 'acme-platform',
        });

        expect(archived.archivedAt).toBeInstanceOf(Date);
        expect(archivedAgain.archivedAt).toEqual(archived.archivedAt);
        expect(archivedAgain.slug).toBe('acme-platform');
      });
    });

    it('hides cross-workspace projects and gives foreign ids the same result as missing ids', async () => {
      await withProjectSchema(async ({ store }) => {
        const visible = await store.listProjects(ACCOUNT_A, { includeArchived: true });
        expect(visible.map(({ id }) => id)).not.toContain(PROJECT_B);

        const operations = [
          (projectId: string) => store.getProject(ACCOUNT_A, projectId),
          (projectId: string) =>
            store.renameProject(ACCOUNT_A, { projectId, displayName: 'Should Not Change' }),
          (projectId: string) =>
            store.archiveProject(ACCOUNT_A, { projectId, expectedSlug: 'globex-platform' }),
        ];

        for (const operation of operations) {
          const foreign = await publicFailure(operation(PROJECT_B));
          const missing = await publicFailure(operation(MISSING_PROJECT));
          expect(foreign).toMatchObject({ code: 'project_not_found' });
          expect(missing).toMatchObject({ code: 'project_not_found' });
          expect((foreign as Error).message).toBe((missing as Error).message);
        }

        await expect(store.getProject(ACCOUNT_B, PROJECT_B)).resolves.toEqual(
          expect.objectContaining({ id: PROJECT_B, workspaceId: WORKSPACE_B }),
        );
      });
    });

    it('stops resolving archived projects through the shared core adapter', async () => {
      await withProjectSchema(async ({ source, store }) => {
        await store.archiveProject(ACCOUNT_A, {
          projectId: PROJECT_A,
          expectedSlug: 'acme-platform',
        });

        const adapter = new PostgresStoreAdapter(source);
        await adapter.withScope(
          { workspaceId: WORKSPACE_A, actorId: ACTOR_A },
          async (scopedStore) => {
            expect(await scopedStore.getProject(PROJECT_A)).toBeNull();
            expect(await scopedStore.getProjectBySlug('acme-platform')).toBeNull();
          },
        );
      });
    });
  },
);
