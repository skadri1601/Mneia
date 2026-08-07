import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { AccessScope, ContextItem, SqlValue } from '../../packages/core/src/index.js';
import { ACCESS_SCOPES, migrate, WORKSPACE_SETTING } from '../../packages/core/src/index.js';
import type { VisibilityViewer } from '../../packages/core/src/store/scope.js';
import { canRead, visibilityPredicate } from '../../packages/core/src/store/scope.js';
import { PgDriver } from './pg-driver.js';

const connectionString = process.env.DATABASE_URL;

const WS = '11111111-1111-4111-8111-1111111111aa';
const ACTOR_A = '22222222-2222-4222-8222-2222222222aa';
const ACTOR_B = '22222222-2222-4222-8222-2222222222bb';
const TEAM_ALPHA = '33333333-3333-4333-8333-3333333333aa';
const TEAM_BETA = '33333333-3333-4333-8333-3333333333bb';
const PROJECT_ALPHA = '44444444-4444-4444-8444-4444444444aa';
const PROJECT_BETA = '44444444-4444-4444-8444-4444444444bb';
const EPOCH = new Date('2026-01-01T00:00:00.000Z');

const READER_A: VisibilityViewer = {
  actorId: ACTOR_A,
  teamIds: [TEAM_ALPHA],
  projectTeamId: TEAM_ALPHA,
};

const READER_B: VisibilityViewer = {
  actorId: ACTOR_B,
  teamIds: [TEAM_BETA],
  projectTeamId: TEAM_ALPHA,
};

let schemaCounter = 0;

const connect = async (): Promise<Client> => {
  const client = new Client({ connectionString });
  await client.connect();
  return client;
};

async function withSeededSchema<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const schema = `mne169_${process.pid}_${++schemaCounter}`;
  const client = await connect();

  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await migrate(new PgDriver(client), { appliedBy: 'integration' });
    await client.query('SELECT set_config($1, $2, false)', [WORKSPACE_SETTING, WS]);
    await seed(client);
    return await run(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

async function seed(client: Client): Promise<void> {
  await client.query('INSERT INTO workspace (id, slug, display_name) VALUES ($1, $2, $2)', [
    WS,
    'acme',
  ]);

  for (const [id, name] of [
    [ACTOR_A, 'Ada'],
    [ACTOR_B, 'Bruno'],
  ] as const) {
    await client.query(
      'INSERT INTO actor (id, workspace_id, kind, display_name) VALUES ($1, $2, $3::actor_kind, $4)',
      [id, WS, 'human', name],
    );
  }

  for (const [id, slug] of [
    [TEAM_ALPHA, 'alpha'],
    [TEAM_BETA, 'beta'],
  ] as const) {
    await client.query(
      'INSERT INTO team (id, workspace_id, slug, display_name) VALUES ($1, $2, $3, $3)',
      [id, WS, slug],
    );
  }

  for (const [teamId, actorId] of [
    [TEAM_ALPHA, ACTOR_A],
    [TEAM_BETA, ACTOR_B],
  ] as const) {
    await client.query(
      'INSERT INTO team_member (workspace_id, team_id, actor_id) VALUES ($1, $2, $3)',
      [WS, teamId, actorId],
    );
  }

  for (const [id, teamId, slug] of [
    [PROJECT_ALPHA, TEAM_ALPHA, 'alpha-work'],
    [PROJECT_BETA, TEAM_BETA, 'beta-work'],
  ] as const) {
    await client.query(
      'INSERT INTO project (id, workspace_id, team_id, slug) VALUES ($1, $2, $3, $4)',
      [id, WS, teamId, slug],
    );
  }

  for (const accessScope of ACCESS_SCOPES) {
    for (const [actorId, suffix] of [
      [ACTOR_A, 'a'],
      [ACTOR_B, 'b'],
    ] as const) {
      await insertItem(client, PROJECT_ALPHA, accessScope, actorId, `${accessScope}-by-${suffix}`);
    }
  }

  await insertItem(client, PROJECT_BETA, 'team', ACTOR_A, 'beta-team-by-a');
}

async function insertItem(
  client: Client,
  projectId: string,
  accessScope: AccessScope,
  assertedBy: string,
  title: string,
): Promise<void> {
  await client.query(
    `INSERT INTO context_item (id, workspace_id, project_id, kind, title, asserted_by, access_scope)
     VALUES (gen_random_uuid(), $1, $2, 'decision'::item_kind, $3, $4, $5::access_scope)`,
    [WS, projectId, title, assertedBy, accessScope],
  );
}

const fragmentFor = (viewer: VisibilityViewer, projectId: string, paramOffset: number) =>
  visibilityPredicate({
    scope: { workspaceId: WS, actorId: viewer.actorId },
    actorTeamIds: viewer.teamIds,
    projectId,
    paramOffset,
  });

async function visibleInProject(
  client: Client,
  viewer: VisibilityViewer,
  projectId: string,
): Promise<string[]> {
  const fragment = fragmentFor(viewer, projectId, 1);
  const params: SqlValue[] = [projectId, ...fragment.params];
  const result = await client.query(
    `SELECT title FROM context_item WHERE project_id = $1 AND ${fragment.sql}`,
    params,
  );

  return result.rows.map((row) => row.title as string).sort();
}

async function visibleAcrossProjects(
  client: Client,
  viewer: VisibilityViewer,
  projectId: string,
): Promise<string[]> {
  const fragment = fragmentFor(viewer, projectId, 0);
  const result = await client.query(`SELECT title FROM context_item WHERE ${fragment.sql}`, [
    ...fragment.params,
  ]);

  return result.rows.map((row) => row.title as string).sort();
}

interface ItemRow {
  readonly id: string;
  readonly project_id: string;
  readonly title: string;
  readonly asserted_by: string;
  readonly access_scope: AccessScope;
}

const asContextItem = (row: ItemRow): ContextItem => ({
  id: row.id,
  workspaceId: WS,
  projectId: row.project_id,
  kind: 'decision',
  title: row.title,
  body: null,
  status: 'active',
  assertedBy: row.asserted_by,
  assertedAt: EPOCH,
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.5,
  humanConfirmed: false,
  loadBearing: false,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: EPOCH,
  validTo: null,
  supersedesId: null,
  supersededById: null,
  accessScope: row.access_scope,
  embedding: null,
  embeddingModel: null,
});

async function itemsInProject(client: Client, projectId: string): Promise<ContextItem[]> {
  const result = await client.query(
    'SELECT id, project_id, title, asserted_by, access_scope FROM context_item WHERE project_id = $1',
    [projectId],
  );

  return result.rows.map((row) => asContextItem(row as ItemRow));
}

describe.skipIf(connectionString === undefined)('scope enforcement at the query layer', () => {
  afterAll(async () => {
    const client = await connect();
    await client.query(
      `DO $$
       DECLARE s TEXT;
       BEGIN
         FOR s IN SELECT nspname FROM pg_namespace WHERE nspname LIKE 'mne169_%'
         LOOP EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', s);
         END LOOP;
       END $$`,
    );
    await client.end();
  });

  it('shows a member of the owning team their own items plus project, team and workspace scopes', async () => {
    await withSeededSchema(async (client) => {
      const visible = await visibleInProject(client, READER_A, PROJECT_ALPHA);

      expect(visible).toEqual(
        [
          'private-by-a',
          'project-by-a',
          'project-by-b',
          'restricted-by-a',
          'team-by-a',
          'team-by-b',
          'workspace-by-a',
          'workspace-by-b',
        ].sort(),
      );
    });
  });

  it('hides team-scoped items from an actor on a different team', async () => {
    await withSeededSchema(async (client) => {
      const visible = await visibleInProject(client, READER_B, PROJECT_ALPHA);

      expect(visible).toEqual(
        [
          'private-by-b',
          'project-by-b',
          'restricted-by-b',
          'team-by-b',
          'workspace-by-a',
          'workspace-by-b',
        ].sort(),
      );
      expect(visible).not.toContain('team-by-a');
      expect(visible).not.toContain('project-by-a');
    });
  });

  it('hides a project-scoped item in one team from an actor on another, through every read path', async () => {
    await withSeededSchema(async (client) => {
      const inProject = await visibleInProject(client, READER_B, PROJECT_ALPHA);
      const acrossProjects = await visibleAcrossProjects(client, READER_B, PROJECT_ALPHA);
      const rowByRow = (await itemsInProject(client, PROJECT_ALPHA))
        .filter((item) => canRead(item, READER_B))
        .map((item) => item.title);

      for (const path of [inProject, acrossProjects, rowByRow]) {
        expect(path).not.toContain('project-by-a');
      }
    });
  });

  it('makes that same item visible through every read path once it is raised to workspace', async () => {
    await withSeededSchema(async (client) => {
      await client.query(
        "UPDATE context_item SET access_scope = 'workspace'::access_scope WHERE title = $1",
        ['project-by-a'],
      );

      const inProject = await visibleInProject(client, READER_B, PROJECT_ALPHA);
      const acrossProjects = await visibleAcrossProjects(client, READER_B, PROJECT_ALPHA);
      const rowByRow = (await itemsInProject(client, PROJECT_ALPHA))
        .filter((item) => canRead(item, READER_B))
        .map((item) => item.title);

      for (const path of [inProject, acrossProjects, rowByRow]) {
        expect(path).toContain('project-by-a');
      }
    });
  });

  it('keeps a project-scoped item readable when the owning project has no team at all', async () => {
    await withSeededSchema(async (client) => {
      await client.query('UPDATE project SET team_id = NULL WHERE id = $1', [PROJECT_ALPHA]);

      const visible = await visibleInProject(client, READER_B, PROJECT_ALPHA);

      expect(visible).toContain('project-by-a');
      expect(visible).not.toContain('team-by-a');
    });
  });

  it("never leaks one actor's private item to another actor", async () => {
    await withSeededSchema(async (client) => {
      const everything = await client.query(
        'SELECT title FROM context_item WHERE project_id = $1',
        [PROJECT_ALPHA],
      );
      expect(everything.rows.map((row) => row.title as string)).toContain('private-by-a');

      const visible = await visibleInProject(client, READER_B, PROJECT_ALPHA);

      expect(visible).not.toContain('private-by-a');
    });
  });

  it('fails closed on restricted items, showing them only to the actor who asserted them', async () => {
    await withSeededSchema(async (client) => {
      const forA = await visibleInProject(client, READER_A, PROJECT_ALPHA);
      const forB = await visibleInProject(client, READER_B, PROJECT_ALPHA);

      expect(forA).toContain('restricted-by-a');
      expect(forA).not.toContain('restricted-by-b');
      expect(forB).toContain('restricted-by-b');
      expect(forB).not.toContain('restricted-by-a');
    });
  });

  it('builds a valid query for an actor who belongs to no team, and shows them neither team- nor project-scoped items owned by a team', async () => {
    await withSeededSchema(async (client) => {
      const teamless: VisibilityViewer = {
        actorId: ACTOR_B,
        teamIds: [],
        projectTeamId: TEAM_ALPHA,
      };
      const visible = await visibleInProject(client, teamless, PROJECT_ALPHA);

      expect(visible).toEqual(
        [
          'private-by-b',
          'project-by-b',
          'restricted-by-b',
          'team-by-b',
          'workspace-by-a',
          'workspace-by-b',
        ].sort(),
      );
      expect(visible).not.toContain('project-by-a');
      expect(visible).not.toContain('team-by-a');
    });
  });

  it("resolves a team-scoped item through its own project's team, not the reader's", async () => {
    await withSeededSchema(async (client) => {
      const visible = await visibleAcrossProjects(client, READER_B, PROJECT_BETA);

      expect(visible).toContain('beta-team-by-a');
      expect(visible).not.toContain('team-by-a');
      expect(visible).toEqual(
        [
          'beta-team-by-a',
          'private-by-b',
          'project-by-b',
          'restricted-by-b',
          'team-by-b',
          'workspace-by-a',
          'workspace-by-b',
        ].sort(),
      );
    });
  });

  it('agrees with canRead row for row', async () => {
    await withSeededSchema(async (client) => {
      const rows = await itemsInProject(client, PROJECT_ALPHA);
      expect(rows).toHaveLength(ACCESS_SCOPES.length * 2);

      for (const viewer of [READER_A, READER_B]) {
        const fromSql = await visibleInProject(client, viewer, PROJECT_ALPHA);
        const fromMemory = rows
          .filter((item) => canRead(item, viewer))
          .map((item) => item.title)
          .sort();

        expect(fromSql).toEqual(fromMemory);
      }
    });
  });

  it('leaves the placeholders of a surrounding query untouched', async () => {
    await withSeededSchema(async (client) => {
      const fragment = fragmentFor(READER_A, PROJECT_ALPHA, 2);
      const params: SqlValue[] = [PROJECT_ALPHA, 'workspace', ...fragment.params];
      const result = await client.query(
        `SELECT title FROM context_item
          WHERE project_id = $1 AND access_scope = $2::access_scope AND ${fragment.sql}`,
        params,
      );

      expect(result.rows.map((row) => row.title as string).sort()).toEqual([
        'workspace-by-a',
        'workspace-by-b',
      ]);
    });
  });
});
