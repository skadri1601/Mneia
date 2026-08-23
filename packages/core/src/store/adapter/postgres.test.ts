import { describe, expect, it } from 'vitest';
import { SupersedeNotAllowedError } from '../../policy/index.js';
import type { SqlResult, SqlValue } from '../driver.js';
import { RLS_POSTURE_SQL } from '../rls-guard.js';
import type { ActorKind } from '../schema.js';
import type { PostgresConnectionSource, PostgresSession } from './postgres.js';
import {
  FOREIGN_KEY_VIOLATION,
  PostgresStoreAdapter,
  StoreError as StoreErrorClass,
  type StoreError,
  translateIntegrityViolation,
} from './postgres.js';
import type { CheckpointWrite } from './types.js';

const SCOPE = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  actorId: '22222222-2222-4222-8222-222222222222',
};

const isPostureQuery = (sql: string): boolean => sql.includes('pg_catalog.pg_roles');

const postureRows = (bypassesRls = false): Record<string, unknown>[] => [
  {
    role_name: bypassesRls ? 'neondb_owner' : 'mneia_app',
    session_role_name: bypassesRls ? 'neondb_owner' : 'mneia_app',
    role_is_superuser: false,
    role_bypasses_rls: bypassesRls,
    granting_role: null,
    granting_is_superuser: false,
    granting_bypasses_rls: false,
  },
];

class FakeSession implements PostgresSession {
  readonly calls: string[] = [];
  releaseCount = 0;
  discardCount = 0;

  constructor(
    private readonly rollbackFailure: Error | null = null,
    private readonly bypassesRls = false,
  ) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    _params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    this.calls.push(sql);
    if (isPostureQuery(sql)) {
      return { rows: postureRows(this.bypassesRls) as TRow[] };
    }
    if (sql === 'ROLLBACK' && this.rollbackFailure !== null) {
      throw this.rollbackFailure;
    }
    return { rows: [] };
  }

  async release(): Promise<void> {
    this.releaseCount += 1;
  }

  async discard(): Promise<void> {
    this.discardCount += 1;
  }
}

class FakeSource implements PostgresConnectionSource {
  constructor(readonly session: PostgresSession) {}

  async acquire(): Promise<PostgresSession> {
    return this.session;
  }

  async close(): Promise<void> {}
}

const ARCHIVED_PROJECT_ID = '33333333-3333-4333-8333-333333333333';

class ArchivedProjectSession implements PostgresSession {
  readonly calls: string[] = [];

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    _params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    this.calls.push(sql);
    if (isPostureQuery(sql)) {
      return { rows: postureRows() as TRow[] };
    }
    if (sql.includes('FROM project') && !sql.includes('archived_at IS NULL')) {
      return {
        rows: [
          {
            id: ARCHIVED_PROJECT_ID,
            workspace_id: SCOPE.workspaceId,
            team_id: null,
            slug: 'archived-project',
            repo_url: null,
            created_at: new Date('2026-08-01T00:00:00.000Z'),
          } as TRow,
        ],
      };
    }
    return { rows: [] };
  }

  async release(): Promise<void> {}

  async discard(): Promise<void> {}
}

const PROJECT = '77777777-7777-4777-8777-777777777777';
const TARGET_ITEM = '55555555-5555-4555-8555-555555555555';
const REPLACEMENT_ITEM = '66666666-6666-4666-8666-666666666666';
const HUMAN_ASSERTER = '88888888-8888-4888-8888-888888888888';
const AGENT_ASSERTER = '99999999-9999-4999-8999-999999999999';
const CHECKPOINT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TIMESTAMP = new Date('2026-08-01T00:00:00.000Z');

type Row = Record<string, unknown>;

const targetItemRow = (overrides: Row = {}): Row => ({
  id: TARGET_ITEM,
  workspace_id: SCOPE.workspaceId,
  project_id: PROJECT,
  kind: 'constraint',
  title: 'never deploy on Fridays',
  body: null,
  status: 'active',
  asserted_by: HUMAN_ASSERTER,
  asserted_at: TIMESTAMP,
  source_session_id: null,
  source_ref: null,
  confidence: 0.9,
  human_confirmed: true,
  load_bearing: true,
  last_verified_at: null,
  decay_after: null,
  valid_from: TIMESTAMP,
  valid_to: null,
  supersedes_id: null,
  superseded_by_id: null,
  supersede_reason: null,
  access_scope: 'project',
  embedding: null,
  embedding_model: null,
  ...overrides,
});

class SupersedeSession implements PostgresSession {
  readonly calls: string[] = [];
  readonly params: (readonly SqlValue[])[] = [];

  constructor(
    private readonly actorKind: ActorKind | null,
    private readonly target: Row | null,
  ) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    this.calls.push(sql);
    this.params.push(params);

    if (isPostureQuery(sql)) {
      return { rows: postureRows() as TRow[] };
    }

    if (sql.includes('FROM actor')) {
      if (this.actorKind === null) return { rows: [] };
      return {
        rows: [
          {
            id: SCOPE.actorId,
            workspace_id: SCOPE.workspaceId,
            kind: this.actorKind,
            display_name: 'the scoped actor',
            external_ref: null,
            created_at: TIMESTAMP,
          } as TRow,
        ],
      };
    }

    if (sql.includes('FROM context_item') && !sql.includes('INSERT INTO context_item')) {
      return { rows: this.target === null ? [] : [this.target as TRow] };
    }

    if (sql.includes('INSERT INTO checkpoint (')) {
      return {
        rows: [
          {
            id: CHECKPOINT_ID,
            workspace_id: SCOPE.workspaceId,
            project_id: PROJECT,
            session_id: null,
            actor_id: SCOPE.actorId,
            trigger: 'task_boundary',
            created_at: TIMESTAMP,
            summary: null,
          } as TRow,
        ],
      };
    }

    if (sql.includes('INSERT INTO context_item')) {
      return {
        rows: [
          targetItemRow({
            id: REPLACEMENT_ITEM,
            title: 'deploy on Fridays behind a flag',
            human_confirmed: this.actorKind === 'human',
            supersedes_id: TARGET_ITEM,
          }) as TRow,
        ],
      };
    }

    if (sql.includes('UPDATE context_item')) {
      return { rows: [{ id: TARGET_ITEM } as TRow] };
    }

    if (sql.includes('INSERT INTO checkpoint_item')) {
      return {
        rows: [
          {
            workspace_id: SCOPE.workspaceId,
            checkpoint_id: CHECKPOINT_ID,
            item_id: REPLACEMENT_ITEM,
            action: 'superseded',
          } as TRow,
        ],
      };
    }

    return { rows: [] };
  }

  async release(): Promise<void> {}

  async discard(): Promise<void> {}
}

const supersedingCheckpoint = (assertedBy: string): CheckpointWrite => ({
  checkpoint: { projectId: PROJECT, actorId: SCOPE.actorId, trigger: 'task_boundary' },
  items: [
    {
      action: 'superseded',
      item: {
        projectId: PROJECT,
        kind: 'decision',
        title: 'deploy on Fridays behind a flag',
        assertedBy,
        supersedesId: TARGET_ITEM,
      },
    },
  ],
});

const callIndex = (calls: readonly string[], fragment: string): number =>
  calls.findIndex((sql) => sql.includes(fragment));

describe('PostgresStoreAdapter supersede policy', () => {
  it('resolves the asserting actor kind from the scoped actor rather than the write payload', async () => {
    const session = new SupersedeSession('agent', targetItemRow());
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    await expect(
      adapter.withScope(SCOPE, (store) =>
        store.writeCheckpoint(supersedingCheckpoint(HUMAN_ASSERTER)),
      ),
    ).rejects.toBeInstanceOf(SupersedeNotAllowedError);

    const lookup = callIndex(session.calls, 'FROM actor');
    expect(lookup).toBeGreaterThan(-1);
    expect(session.params[lookup]).toEqual([SCOPE.workspaceId, SCOPE.actorId]);
  });

  it('blocks an agent assertion against a human-confirmed item and writes nothing', async () => {
    const session = new SupersedeSession('agent', targetItemRow());
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const error = await adapter
      .withScope(SCOPE, (store) => store.writeCheckpoint(supersedingCheckpoint(SCOPE.actorId)))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SupersedeNotAllowedError);
    expect(error).toMatchObject({
      outcome: 'requires_human_confirmation',
      itemId: TARGET_ITEM,
    });
    expect((error as SupersedeNotAllowedError).message).toContain(TARGET_ITEM);
    expect((error as SupersedeNotAllowedError).message).toContain('§10.1 step 5');

    expect(callIndex(session.calls, 'INSERT INTO context_item')).toBe(-1);
    expect(callIndex(session.calls, 'UPDATE context_item')).toBe(-1);
    expect(callIndex(session.calls, 'INSERT INTO checkpoint_item')).toBe(-1);
  });

  it('refuses a target that already has a successor so only one replacement wins', async () => {
    const session = new SupersedeSession(
      'human',
      targetItemRow({ superseded_by_id: REPLACEMENT_ITEM }),
    );
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const error = await adapter
      .withScope(SCOPE, (store) => store.writeCheckpoint(supersedingCheckpoint(SCOPE.actorId)))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ outcome: 'refused', itemId: TARGET_ITEM });
    expect(callIndex(session.calls, 'UPDATE context_item')).toBe(-1);
  });

  it('locks the target FOR UPDATE before it inserts the replacement or marks the row superseded', async () => {
    const session = new SupersedeSession(
      'human',
      targetItemRow({ human_confirmed: false, load_bearing: false, asserted_by: AGENT_ASSERTER }),
    );
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const result = await adapter.withScope(SCOPE, (store) =>
      store.writeCheckpoint(supersedingCheckpoint(SCOPE.actorId)),
    );

    expect(result.written.map((item) => item.id)).toEqual([REPLACEMENT_ITEM]);

    const locked = callIndex(session.calls, 'FOR UPDATE');
    const inserted = callIndex(session.calls, 'INSERT INTO context_item');
    const linked = callIndex(session.calls, 'UPDATE context_item');

    expect(locked).toBeGreaterThan(-1);
    expect(locked).toBeLessThan(inserted);
    expect(locked).toBeLessThan(linked);
  });

  it('names the scoped actor when its kind cannot be resolved', async () => {
    const session = new SupersedeSession(null, targetItemRow());
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const error = await adapter
      .withScope(SCOPE, (store) => store.writeCheckpoint(supersedingCheckpoint(SCOPE.actorId)))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'not_found' } satisfies Partial<StoreError>);
    expect((error as StoreError).message).toContain(SCOPE.actorId);
    expect((error as StoreError).message).toMatch(/open the scope with an actor row that exists/);
    expect(callIndex(session.calls, 'FOR UPDATE')).toBe(-1);
  });

  it('names the missing target when the item to supersede is not in the workspace', async () => {
    const session = new SupersedeSession('human', null);
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const error = await adapter
      .withScope(SCOPE, (store) => store.writeCheckpoint(supersedingCheckpoint(SCOPE.actorId)))
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'not_found' } satisfies Partial<StoreError>);
    expect((error as StoreError).message).toContain(TARGET_ITEM);
    expect((error as StoreError).message).toMatch(/re-read the chain/);
  });
});

describe('PostgresStoreAdapter transaction cleanup', () => {
  it('releases the session after a successful rollback', async () => {
    const session = new FakeSession();
    const adapter = new PostgresStoreAdapter(new FakeSource(session));
    const failure = new Error('write failed');

    await expect(
      adapter.withScope(SCOPE, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(session.calls).toEqual([
      RLS_POSTURE_SQL,
      'BEGIN',
      'SELECT set_config($1, $2, true)',
      'ROLLBACK',
    ]);
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });

  it('discards an unusable session after rollback fails', async () => {
    const rollbackFailure = new Error('rollback failed');
    const session = new FakeSession(rollbackFailure);
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const error = await adapter
      .withScope(SCOPE, async () => {
        throw new Error('write failed');
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: 'rollback_failed',
      cause: rollbackFailure,
    } satisfies Partial<StoreError>);
    expect(session.releaseCount).toBe(0);
    expect(session.discardCount).toBe(1);
  });
});

describe('PostgresStoreAdapter scoped membership lookup', () => {
  it('shares one team membership query across concurrent reads', async () => {
    const session = new FakeSession();
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    await adapter.withScope(SCOPE, async (store) => {
      await Promise.all([
        store.listContextItems({ projectId: PROJECT, limit: 1 }),
        store.listContextItems({ projectId: PROJECT, loadBearing: true, limit: 1 }),
        store.listContextItems({ projectId: PROJECT, statuses: ['superseded'], limit: 1 }),
      ]);
    });

    expect(session.calls.filter((sql) => sql.includes('FROM team_member'))).toHaveLength(1);
    const itemRead = session.calls.find((sql) => sql.includes('FROM context_item')) ?? '';
    expect(itemRead).toContain("context_item.access_scope = 'project'");
    expect(itemRead).toContain('context_item.project_id IN');
  });

  it('selects all rehydration candidate groups in one context item query', async () => {
    const session = new FakeSession();
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const groups = await adapter.withScope(SCOPE, async (store) => {
      if (store.selectRehydrationCandidates === undefined) {
        return null;
      }
      return store.selectRehydrationCandidates({
        projectId: PROJECT,
        asOf: TIMESTAMP,
        candidateLimit: 160,
        mandatoryLimit: 1000,
        supersededLimit: 5,
      });
    });

    expect(groups).toEqual({ candidates: [], mandatory: [], superseded: [], relevance: new Map() });
    expect(session.calls.filter((sql) => sql.includes('FROM context_item'))).toHaveLength(1);
    const itemRead = session.calls.find((sql) => sql.includes('FROM context_item')) ?? '';
    expect(itemRead).toContain('JOIN actor AS provenance_actor');
    expect(itemRead).toContain('LEFT JOIN session AS provenance_session');
    expect(itemRead).toContain('provenance_session.workspace_id = context_item.workspace_id');
    expect(itemRead).toContain('provenance_session.project_id = context_item.project_id');
    expect(itemRead).toContain('provenance_session.actor_id = context_item.asserted_by');
  });
});

describe('PostgresStoreAdapter row-level security guard', () => {
  it('refuses a connection that bypasses row-level security before it opens a transaction', async () => {
    const session = new FakeSession(null, true);
    const adapter = new PostgresStoreAdapter(new FakeSource(session));
    let ran = false;

    const error = await adapter
      .withScope(SCOPE, async () => {
        ran = true;
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ name: 'RlsGuardError', code: 'bypasses_rls' });
    expect(ran).toBe(false);
    expect(session.calls).toEqual([RLS_POSTURE_SQL]);
  });

  it('releases the session after refusing a bypassing connection', async () => {
    const session = new FakeSession(null, true);
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    await expect(adapter.withScope(SCOPE, async () => undefined)).rejects.toThrow(/bypasses it/);

    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });
});

describe('PostgresStoreAdapter active project resolution', () => {
  it('does not resolve an archived project by id', async () => {
    const session = new ArchivedProjectSession();
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const project = await adapter.withScope(SCOPE, (store) =>
      store.getProject(ARCHIVED_PROJECT_ID),
    );

    expect(project).toBeNull();
  });

  it('does not resolve an archived project by slug', async () => {
    const session = new ArchivedProjectSession();
    const adapter = new PostgresStoreAdapter(new FakeSource(session));

    const project = await adapter.withScope(SCOPE, (store) =>
      store.getProjectBySlug('archived-project'),
    );

    expect(project).toBeNull();
  });
});

describe('translateIntegrityViolation', () => {
  const violation = (over: Record<string, unknown> = {}): unknown =>
    Object.assign(new Error('insert or update on table "checkpoint" violates foreign key'), {
      code: FOREIGN_KEY_VIOLATION,
      constraint: 'checkpoint_workspace_id_project_id_fkey',
      detail:
        'Key (workspace_id, project_id)=(874090eb-c7bc-49ef-b653-93e24148a92c, 874090eb-c7bc-49ef-b653-93e24148a92c) is not present in table "project".',
      table: 'checkpoint',
      ...over,
    });

  it('turns a foreign-key violation into not_found rather than an unmapped crash', () => {
    const translated = translateIntegrityViolation(violation());

    expect(translated).toBeInstanceOf(StoreErrorClass);
    expect((translated as InstanceType<typeof StoreErrorClass>).code).toBe('not_found');
  });

  it('names the constraint and echoes the ids the caller sent, so the wrong one is visible', () => {
    const message = (translateIntegrityViolation(violation()) as Error).message;

    expect(message).toContain('checkpoint_workspace_id_project_id_fkey');
    expect(message).toContain('874090eb-c7bc-49ef-b653-93e24148a92c');
    expect(message).toContain('Nothing was written.');
  });

  it('keeps the driver error as the cause', () => {
    const original = violation();

    expect((translateIntegrityViolation(original) as Error).cause).toBe(original);
  });

  it('passes any other database error through untouched, rather than mislabelling it', () => {
    const other = violation({ code: '23505' });

    expect(translateIntegrityViolation(other)).toBe(other);
  });

  it('passes non-objects through, because a thrown string has no SQLSTATE', () => {
    expect(translateIntegrityViolation('boom')).toBe('boom');
    expect(translateIntegrityViolation(null)).toBeNull();
  });

  it('still reads when the driver supplies no constraint or detail', () => {
    const bare = translateIntegrityViolation(
      violation({ constraint: undefined, detail: undefined, table: undefined }),
    );

    expect((bare as Error).message).toContain('a referenced row does not exist');
  });
});
