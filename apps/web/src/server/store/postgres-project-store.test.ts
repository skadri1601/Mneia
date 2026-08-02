import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type PostgresConnectionSource,
  type PostgresSession,
  RLS_POSTURE_SQL,
  type SqlResult,
  type SqlRow,
  type SqlValue,
} from '@mneia/core';
import type { AccountContext } from './account-store.js';
import { PostgresProjectStore } from './postgres-project-store.js';
import type { ProjectControlError } from './project-store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');
const ARCHIVED_AT = new Date('2026-08-01T12:00:00.000Z');

const account: AccountContext = {
  workspace: {
    id: WORKSPACE_ID,
    slug: `workspace-${WORKSPACE_ID}`,
    displayName: 'Ada Lovelace',
    plan: 'solo',
    billingStatus: 'active',
    billingCustomerRef: null,
    seatsPurchased: null,
    checkpointAllowance: null,
    trialEndsAt: null,
    createdAt: CREATED_AT,
  },
  actor: {
    id: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    kind: 'human',
    displayName: 'Ada Lovelace',
    externalRef: 'user_123',
    createdAt: CREATED_AT,
  },
  team: {
    id: TEAM_ID,
    workspaceId: WORKSPACE_ID,
    slug: 'default',
    displayName: 'Default',
    function: 'engineering',
    createdAt: CREATED_AT,
  },
  membership: {
    workspaceId: WORKSPACE_ID,
    teamId: TEAM_ID,
    actorId: ACTOR_ID,
    role: 'lead',
    addedAt: CREATED_AT,
  },
};

interface SqlCall {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

type Step = readonly SqlRow[] | Error;

const projectRow = (overrides: Partial<SqlRow> = {}): SqlRow => ({
  id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  team_id: TEAM_ID,
  slug: 'mneia',
  display_name: 'Mneia',
  repo_url: 'https://github.com/mneia/mneia',
  archived_at: null,
  created_at: CREATED_AT,
  ...overrides,
});

class FakeSession implements PostgresSession {
  readonly calls: SqlCall[] = [];
  releaseCount = 0;
  discardCount = 0;

  constructor(
    private readonly steps: Step[] = [],
    private readonly bypassesRls = false,
    private readonly releaseFailure?: Error,
    private readonly discardFailure?: Error,
  ) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    this.calls.push({ sql, params });
    if (sql === RLS_POSTURE_SQL) {
      return {
        rows: [
          {
            role_name: 'mneia_app',
            session_role_name: 'mneia_app',
            role_is_superuser: false,
            role_bypasses_rls: this.bypassesRls,
            granting_role: null,
            granting_is_superuser: false,
            granting_bypasses_rls: false,
          } as TRow,
        ],
      };
    }
    const step = this.steps.shift();
    if (step === undefined) {
      throw new Error(`unexpected SQL: ${sql}`);
    }
    if (step instanceof Error) {
      throw step;
    }
    return { rows: step as readonly TRow[] };
  }

  async release(): Promise<void> {
    this.releaseCount += 1;
    if (this.releaseFailure !== undefined) {
      throw this.releaseFailure;
    }
  }

  async discard(): Promise<void> {
    this.discardCount += 1;
    if (this.discardFailure !== undefined) {
      throw this.discardFailure;
    }
  }
}

const statements = (session: FakeSession): string[] =>
  session.calls.slice(1).map(({ sql }) => sql.replace(/\s+/g, ' ').trim());

const authorizedSteps = (...operationSteps: Step[]): Step[] => [
  [],
  [],
  [],
  [{ authorized: 1 }],
  ...operationSteps,
];

class FakeSource implements PostgresConnectionSource {
  constructor(readonly session: FakeSession) {}

  async acquire(): Promise<PostgresSession> {
    return this.session;
  }

  async close(): Promise<void> {}
}

describe('PostgresProjectStore', () => {
  it('refuses an RLS-bypassing connection before BEGIN and releases it', async () => {
    const session = new FakeSession([], true);
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.listProjects(account, { includeArchived: false })).rejects.toMatchObject({
      code: 'bypasses_rls',
    });
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0]?.sql).toBe(RLS_POSTURE_SQL);
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });

  it('lists active projects in deterministic order inside the trusted account scope', async () => {
    const session = new FakeSession(authorizedSteps([projectRow()], []));
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.listProjects(account, { includeArchived: false })).resolves.toEqual([
      {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ID,
        slug: 'mneia',
        displayName: 'Mneia',
        repoUrl: 'https://github.com/mneia/mneia',
        archivedAt: null,
        createdAt: CREATED_AT,
      },
    ]);
    expect(statements(session)).toEqual([
      'BEGIN',
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'SELECT set_config($1, $2, true)',
      "SELECT 1 AS authorized FROM team_member AS membership INNER JOIN team AS default_team ON default_team.workspace_id = membership.workspace_id AND default_team.id = membership.team_id WHERE membership.workspace_id = $1 AND membership.team_id = $2 AND membership.actor_id = $3 AND membership.role = 'lead' AND default_team.slug = 'default' LIMIT 1",
      'SELECT id, workspace_id, team_id, slug, display_name, repo_url, archived_at, created_at FROM project WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY display_name ASC, id ASC',
      'COMMIT',
    ]);
    expect(session.calls.slice(1).map(({ params }) => params)).toEqual([
      [],
      [],
      ['mneia.workspace_id', WORKSPACE_ID],
      [WORKSPACE_ID, TEAM_ID, ACTOR_ID],
      [WORKSPACE_ID],
      [],
    ]);
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });

  it('rejects an account whose actor is not the persisted default-team lead', async () => {
    const session = new FakeSession([[], [], [], [], []]);
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.listProjects(account, { includeArchived: false })).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(statements(session)).toEqual([
      'BEGIN',
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'SELECT set_config($1, $2, true)',
      "SELECT 1 AS authorized FROM team_member AS membership INNER JOIN team AS default_team ON default_team.workspace_id = membership.workspace_id AND default_team.id = membership.team_id WHERE membership.workspace_id = $1 AND membership.team_id = $2 AND membership.actor_id = $3 AND membership.role = 'lead' AND default_team.slug = 'default' LIMIT 1",
      'ROLLBACK',
    ]);
    expect(session.releaseCount).toBe(1);
  });

  it('optionally lists archived projects and strictly parses their timestamp', async () => {
    const archivedTimestamp = ARCHIVED_AT.toISOString();
    const session = new FakeSession(
      authorizedSteps([projectRow({ archived_at: archivedTimestamp })], []),
    );
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.listProjects(account, { includeArchived: true })).resolves.toEqual([
      expect.objectContaining({ id: PROJECT_ID, archivedAt: ARCHIVED_AT }),
    ]);
    expect(statements(session).at(-2)).toBe(
      'SELECT id, workspace_id, team_id, slug, display_name, repo_url, archived_at, created_at FROM project WHERE workspace_id = $1 ORDER BY display_name ASC, id ASC',
    );
  });

  it.each([
    ['a non-text display name', { display_name: null }],
    ['an invalid archived timestamp', { archived_at: 'not-a-timestamp' }],
  ])('rejects corrupt project rows with %s before commit', async (_label, overrides) => {
    const session = new FakeSession(authorizedSteps([projectRow(overrides)], []));
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.listProjects(account, { includeArchived: true })).rejects.toMatchObject({
      code: 'corrupt_project',
    });
    expect(statements(session).at(-1)).toBe('ROLLBACK');
    expect(statements(session)).not.toContain('COMMIT');
  });

  it('returns active or archived project settings in the trusted workspace', async () => {
    const session = new FakeSession(
      authorizedSteps([projectRow({ archived_at: ARCHIVED_AT })], []),
    );
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.getProject(account, PROJECT_ID)).resolves.toMatchObject({
      id: PROJECT_ID,
      archivedAt: ARCHIVED_AT,
    });
    expect(statements(session).at(-2)).toBe(
      'SELECT id, workspace_id, team_id, slug, display_name, repo_url, archived_at, created_at FROM project WHERE workspace_id = $1 AND id = $2',
    );
  });

  it('makes missing and inaccessible projects indistinguishable', async () => {
    const session = new FakeSession(authorizedSteps([], []));
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.getProject(account, PROJECT_ID)).rejects.toMatchObject({
      code: 'project_not_found',
    });
    expect(statements(session).at(-1)).toBe('ROLLBACK');
  });

  it('renames only the display name of an active project', async () => {
    const session = new FakeSession(authorizedSteps([projectRow({ display_name: 'Memory' })], []));
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(
      store.renameProject(account, { projectId: PROJECT_ID, displayName: 'Memory' }),
    ).resolves.toMatchObject({ displayName: 'Memory', slug: 'mneia' });
    expect(statements(session).at(-2)).toBe(
      'UPDATE project SET display_name = $3 WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL RETURNING id, workspace_id, team_id, slug, display_name, repo_url, archived_at, created_at',
    );
    expect(session.calls.at(-2)?.params).toEqual([WORKSPACE_ID, PROJECT_ID, 'Memory']);
  });

  it('archives idempotently only when the immutable slug matches', async () => {
    const session = new FakeSession(
      authorizedSteps([projectRow({ archived_at: ARCHIVED_AT })], []),
    );
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(
      store.archiveProject(account, { projectId: PROJECT_ID, expectedSlug: 'mneia' }),
    ).resolves.toMatchObject({ archivedAt: ARCHIVED_AT, slug: 'mneia' });
    expect(statements(session).at(-2)).toBe(
      'UPDATE project SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE workspace_id = $1 AND id = $2 AND slug = $3 RETURNING id, workspace_id, team_id, slug, display_name, repo_url, archived_at, created_at',
    );
    expect(session.calls.at(-2)?.params).toEqual([WORKSPACE_ID, PROJECT_ID, 'mneia']);
  });

  it('discards a session when an operation and rollback both fail', async () => {
    const operationFailure = new Error('query failed');
    const rollbackFailure = new Error('rollback failed');
    const session = new FakeSession(authorizedSteps(operationFailure, rollbackFailure));
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.getProject(account, PROJECT_ID)).rejects.toMatchObject({
      code: 'rollback_failed',
    });
    expect(session.releaseCount).toBe(0);
    expect(session.discardCount).toBe(1);
  });

  it('reports release failures after a successful operation', async () => {
    const releaseFailure = new Error('release failed');
    const session = new FakeSession(authorizedSteps([projectRow()], []), false, releaseFailure);
    const store = new PostgresProjectStore(new FakeSource(session));

    await expect(store.getProject(account, PROJECT_ID)).rejects.toMatchObject({
      code: 'session_cleanup_failed',
    });
  });

  it('preserves rollback failure when discarding the session also fails', async () => {
    const operationFailure = new Error('query failed');
    const rollbackFailure = new Error('rollback failed');
    const discardFailure = new Error('discard failed');
    const session = new FakeSession(
      authorizedSteps(operationFailure, rollbackFailure),
      false,
      undefined,
      discardFailure,
    );
    const store = new PostgresProjectStore(new FakeSource(session));

    const error = await store.getProject(account, PROJECT_ID).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'session_cleanup_failed' });
    expect((error as ProjectControlError).cause).toBeInstanceOf(AggregateError);
    expect(session.releaseCount).toBe(0);
    expect(session.discardCount).toBe(1);
  });
});
