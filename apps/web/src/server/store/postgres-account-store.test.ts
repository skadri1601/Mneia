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
import { AccountError } from './account-store.js';
import { PostgresAccountStore } from './postgres-account-store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const SUBJECT = 'user_123';
const DISPLAY_NAME = 'Ada Lovelace';
const CREATED_AT = new Date('2026-08-01T00:00:00.000Z');

const workspaceRow = (overrides: Partial<SqlRow> = {}): SqlRow => ({
  id: WORKSPACE_ID,
  slug: `workspace-${WORKSPACE_ID}`,
  display_name: DISPLAY_NAME,
  plan: 'solo',
  billing_status: 'active',
  billing_customer_ref: null,
  seats_purchased: null,
  checkpoint_allowance: null,
  trial_ends_at: null,
  created_at: CREATED_AT,
  ...overrides,
});

const actorRow = (overrides: Partial<SqlRow> = {}): SqlRow => ({
  id: ACTOR_ID,
  workspace_id: WORKSPACE_ID,
  kind: 'human',
  display_name: DISPLAY_NAME,
  external_ref: SUBJECT,
  created_at: CREATED_AT,
  ...overrides,
});

const teamRow = (overrides: Partial<SqlRow> = {}): SqlRow => ({
  id: TEAM_ID,
  workspace_id: WORKSPACE_ID,
  slug: 'default',
  display_name: 'Default',
  function: 'engineering',
  created_at: CREATED_AT,
  ...overrides,
});

const membershipRow = (overrides: Partial<SqlRow> = {}): SqlRow => ({
  workspace_id: WORKSPACE_ID,
  team_id: TEAM_ID,
  actor_id: ACTOR_ID,
  role: 'lead',
  added_at: CREATED_AT,
  ...overrides,
});

interface SqlCall {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

type Step = readonly SqlRow[] | Error;

class FakeSession implements PostgresSession {
  readonly calls: SqlCall[] = [];
  releaseCount = 0;
  discardCount = 0;

  constructor(
    private readonly steps: Step[],
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

class FakeSource implements PostgresConnectionSource {
  constructor(readonly session: FakeSession) {}

  async acquire(): Promise<PostgresSession> {
    return this.session;
  }

  async close(): Promise<void> {}
}

const ids = () => {
  const factory = vi
    .fn<() => string>()
    .mockReturnValueOnce(WORKSPACE_ID)
    .mockReturnValueOnce(ACTOR_ID)
    .mockReturnValueOnce(TEAM_ID);
  return factory;
};

const statements = (session: FakeSession): string[] =>
  session.calls.slice(1).map(({ sql }) => sql.replace(/\s+/g, ' ').trim());

const aggregateErrors = (value: unknown): readonly unknown[] => {
  expect(value).toBeInstanceOf(AggregateError);
  return (value as AggregateError).errors;
};

const blanks = (count: number): Step[] => Array.from({ length: count }, () => []);

const PREAMBLE = 10;
const TEAM_INSERT_STEP = 12;

const createSteps = (): Step[] => [
  ...blanks(PREAMBLE),
  [workspaceRow()],
  [actorRow()],
  [teamRow()],
  [membershipRow()],
  [],
];

const existingSteps = (
  memberships: readonly SqlRow[] = [membershipRow()],
  plan: 'solo' | 'team' | 'enterprise' = 'solo',
): Step[] => [
  ...blanks(7),
  [actorRow()],
  [],
  [],
  [workspaceRow({ plan })],
  memberships,
  [teamRow()],
  [],
];

describe('PostgresAccountStore', () => {
  it('creates one solo account with server-generated ids in the required transaction order', async () => {
    const session = new FakeSession(createSteps());
    const idFactory = ids();
    const store = new PostgresAccountStore(new FakeSource(session), idFactory);

    await expect(
      store.bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME }),
    ).resolves.toEqual({
      workspace: {
        id: WORKSPACE_ID,
        slug: `workspace-${WORKSPACE_ID}`,
        displayName: DISPLAY_NAME,
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
        displayName: DISPLAY_NAME,
        externalRef: SUBJECT,
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
    });

    expect(idFactory).toHaveBeenCalledTimes(3);
    expect(session.releaseCount).toBe(1);
    expect(statements(session)).toEqual([
      'BEGIN',
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT set_config($1, $2, true)',
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      "SELECT id, workspace_id, kind, display_name, external_ref, created_at FROM actor WHERE kind = 'human' AND external_ref = $1",
      "SELECT set_config($1, '', true)",
      'SELECT set_config($1, $2, true)',
      "INSERT INTO workspace (id, slug, display_name, plan) VALUES ($1, $2, $3, 'solo') RETURNING id, slug, display_name, plan, billing_status, billing_customer_ref, seats_purchased, checkpoint_allowance, trial_ends_at, created_at",
      "INSERT INTO actor (id, workspace_id, kind, display_name, external_ref) VALUES ($1, $2, 'human', $3, $4) RETURNING id, workspace_id, kind, display_name, external_ref, created_at",
      "INSERT INTO team (id, workspace_id, slug, display_name, function) VALUES ($1, $2, 'default', 'Default', 'engineering') RETURNING id, workspace_id, slug, display_name, function, created_at",
      "INSERT INTO team_member (workspace_id, team_id, actor_id, role) VALUES ($1, $2, $3, 'lead') RETURNING workspace_id, team_id, actor_id, role, added_at",
      'COMMIT',
    ]);
    expect(session.calls.slice(1).map(({ params }) => params)).toEqual([
      [],
      [],
      ['mneia.workspace_id', ''],
      ['mneia.identity_subject', SUBJECT],
      ['mneia.invitation_email', ''],
      ['mneia.invitation_token_hash', ''],
      [SUBJECT],
      [SUBJECT],
      ['mneia.identity_subject'],
      ['mneia.workspace_id', WORKSPACE_ID],
      [WORKSPACE_ID, `workspace-${WORKSPACE_ID}`, DISPLAY_NAME],
      [ACTOR_ID, WORKSPACE_ID, DISPLAY_NAME, SUBJECT],
      [TEAM_ID, WORKSPACE_ID],
      [WORKSPACE_ID, TEAM_ID, ACTOR_ID],
      [],
    ]);
  });

  it.each(['solo', 'team', 'enterprise'] as const)(
    'reuses the existing %s account without generating ids or writing rows',
    async (plan) => {
      const session = new FakeSession(existingSteps([membershipRow()], plan));
      const idFactory = ids();
      const store = new PostgresAccountStore(new FakeSource(session), idFactory);

      const context = await store.bootstrapSoloAccount({
        subject: SUBJECT,
        displayName: 'New Name',
      });

      expect(context.workspace.id).toBe(WORKSPACE_ID);
      expect(context.workspace.plan).toBe(plan);
      expect(context.actor.id).toBe(ACTOR_ID);
      expect(context.team.id).toBe(TEAM_ID);
      expect(context.membership.role).toBe('lead');
      expect(idFactory).not.toHaveBeenCalled();
      expect(statements(session)).toEqual([
        'BEGIN',
        'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
        'SELECT set_config($1, $2, true)',
        'SELECT set_config($1, $2, true)',
        'SELECT set_config($1, $2, true)',
        'SELECT set_config($1, $2, true)',
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        "SELECT id, workspace_id, kind, display_name, external_ref, created_at FROM actor WHERE kind = 'human' AND external_ref = $1",
        "SELECT set_config($1, '', true)",
        'SELECT set_config($1, $2, true)',
        'SELECT id, slug, display_name, plan, billing_status, billing_customer_ref, seats_purchased, checkpoint_allowance, trial_ends_at, created_at FROM workspace WHERE id = $1',
        'SELECT workspace_id, team_id, actor_id, role, added_at FROM team_member WHERE workspace_id = $1 AND actor_id = $2 ORDER BY added_at ASC LIMIT 1',
        'SELECT id, workspace_id, slug, display_name, function, created_at FROM team WHERE workspace_id = $1 AND id = $2',
        'COMMIT',
      ]);
      expect(session.releaseCount).toBe(1);
      expect(session.discardCount).toBe(0);
    },
  );

  it('resolves an invited member who is not a lead of the default team', async () => {
    const session = new FakeSession(
      existingSteps([membershipRow({ role: 'member' })], 'enterprise'),
    );
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    const context = await store.bootstrapSoloAccount({
      subject: SUBJECT,
      displayName: DISPLAY_NAME,
    });

    expect(context.membership.role).toBe('member');
    expect(context.workspace.id).toBe(WORKSPACE_ID);
    expect(statements(session).at(-1)).toBe('COMMIT');
  });

  it.each([
    ['no membership', []],
    ['multiple memberships', [membershipRow(), membershipRow()]],
  ])('rejects corrupt existing state with %s', async (_label, memberships) => {
    const session = new FakeSession(existingSteps(memberships));
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    await expect(
      store.bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME }),
    ).rejects.toMatchObject({ code: 'corrupt_account' } satisfies Partial<AccountError>);
    expect(statements(session).at(-1)).toBe('ROLLBACK');
    expect(session.releaseCount).toBe(1);
  });

  it('rolls back the transaction failure and releases the session', async () => {
    const failure = new Error('team insert failed');
    const steps = createSteps();
    steps[TEAM_INSERT_STEP] = failure;
    const session = new FakeSession(steps);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    await expect(
      store.bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME }),
    ).rejects.toBe(failure);
    expect(statements(session).at(-1)).toBe('ROLLBACK');
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });

  it('raises rollback_failed and discards the session when rollback also fails', async () => {
    const failure = new Error('team insert failed');
    const rollbackFailure = new Error('rollback failed');
    const steps = createSteps();
    steps[TEAM_INSERT_STEP] = failure;
    steps[TEAM_INSERT_STEP + 1] = rollbackFailure;
    const session = new FakeSession(steps);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    const error = await store
      .bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AccountError);
    expect(error).toMatchObject({ code: 'rollback_failed' } satisfies Partial<AccountError>);
    expect(aggregateErrors((error as AccountError).cause)).toEqual([failure, rollbackFailure]);
    expect(session.releaseCount).toBe(0);
    expect(session.discardCount).toBe(1);
  });

  it('reports a release failure after a successful bootstrap', async () => {
    const releaseFailure = new Error('release failed');
    const session = new FakeSession(createSteps(), false, releaseFailure);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    const error = await store
      .bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AccountError);
    expect(error).toMatchObject({ code: 'session_cleanup_failed' } satisfies Partial<AccountError>);
    expect(aggregateErrors((error as AccountError).cause)).toEqual([releaseFailure]);
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });

  it('preserves a transaction failure when release also fails', async () => {
    const failure = new Error('team insert failed');
    const releaseFailure = new Error('release failed');
    const steps = createSteps();
    steps[TEAM_INSERT_STEP] = failure;
    const session = new FakeSession(steps, false, releaseFailure);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    const error = await store
      .bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AccountError);
    expect(error).toMatchObject({ code: 'session_cleanup_failed' } satisfies Partial<AccountError>);
    expect(aggregateErrors((error as AccountError).cause)).toEqual([failure, releaseFailure]);
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });

  it('preserves rollback failure when discarding the session also fails', async () => {
    const failure = new Error('team insert failed');
    const rollbackFailure = new Error('rollback failed');
    const discardFailure = new Error('discard failed');
    const steps = createSteps();
    steps[TEAM_INSERT_STEP] = failure;
    steps[TEAM_INSERT_STEP + 1] = rollbackFailure;
    const session = new FakeSession(steps, false, undefined, discardFailure);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    const error = await store
      .bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AccountError);
    expect(error).toMatchObject({ code: 'session_cleanup_failed' } satisfies Partial<AccountError>);
    const [rollbackError, cleanupError] = aggregateErrors((error as AccountError).cause);
    expect(rollbackError).toBeInstanceOf(AccountError);
    expect((rollbackError as AccountError).code).toBe('rollback_failed');
    expect(aggregateErrors((rollbackError as AccountError).cause)).toEqual([
      failure,
      rollbackFailure,
    ]);
    expect(cleanupError).toBe(discardFailure);
    expect(session.releaseCount).toBe(0);
    expect(session.discardCount).toBe(1);
  });

  it('refuses an RLS-bypassing connection before BEGIN and releases it', async () => {
    const session = new FakeSession([], true);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    await expect(
      store.bootstrapSoloAccount({ subject: SUBJECT, displayName: DISPLAY_NAME }),
    ).rejects.toMatchObject({ code: 'bypasses_rls' });
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0]?.sql).toBe(RLS_POSTURE_SQL);
    expect(session.releaseCount).toBe(1);
    expect(session.discardCount).toBe(0);
  });
});

const INVITATION_ID = '44444444-4444-4444-8444-444444444444';
const IDENTITY_ID = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const INVITED_ACTOR_ID = '55555555-5555-4555-8555-555555555555';
const INVITED_EMAIL = 'grace@example.com';
const TOKEN_HASH = 'a'.repeat(64);
const EXPIRES_AT = new Date('2026-08-14T00:00:00.000Z');

const invitationRow = (overrides: Partial<SqlRow> = {}): SqlRow => ({
  id: INVITATION_ID,
  workspace_id: WORKSPACE_ID,
  team_id: TEAM_ID,
  invited_email: INVITED_EMAIL,
  role: 'member',
  invited_by: ACTOR_ID,
  created_at: CREATED_AT,
  expires_at: EXPIRES_AT,
  accepted_at: null,
  revoked_at: null,
  ...overrides,
});

const scopeOf = (session: FakeSession): Record<string, string> => {
  const scope: Record<string, string> = {};
  for (const { sql, params } of session.calls) {
    if (sql.includes('set_config') && params.length === 2) {
      scope[String(params[0])] = String(params[1]);
    }
  }
  return scope;
};

describe('PostgresAccountStore invitations', () => {
  it('writes only the token hash, scoped to the inviting workspace', async () => {
    const session = new FakeSession([...blanks(6), [invitationRow()], []]);
    const store = new PostgresAccountStore(
      new FakeSource(session),
      vi.fn<() => string>().mockReturnValue(INVITATION_ID),
    );

    await expect(
      store.inviteToWorkspace({
        workspaceId: WORKSPACE_ID,
        teamId: TEAM_ID,
        invitedByActorId: ACTOR_ID,
        invitedEmail: INVITED_EMAIL,
        role: 'member',
        tokenHash: TOKEN_HASH,
        expiresAt: EXPIRES_AT,
      }),
    ).resolves.toEqual({
      id: INVITATION_ID,
      workspaceId: WORKSPACE_ID,
      teamId: TEAM_ID,
      invitedEmail: INVITED_EMAIL,
      role: 'member',
      invitedBy: ACTOR_ID,
      createdAt: CREATED_AT,
      expiresAt: EXPIRES_AT,
      acceptedAt: null,
      revokedAt: null,
    });

    expect(scopeOf(session)['mneia.workspace_id']).toBe(WORKSPACE_ID);
    const insert = session.calls.find(({ sql }) =>
      sql.includes('INSERT INTO workspace_invitation'),
    );
    expect(insert?.params).toContain(TOKEN_HASH);
    expect(insert?.sql).toContain('token_hash');
    expect(insert?.sql).not.toContain('RETURNING id, workspace_id, team_id, invited_email, token');
    expect(statements(session).at(-1)).toBe('COMMIT');
  });

  it('refuses to revoke an invitation that is already settled', async () => {
    const session = new FakeSession([...blanks(6), [], []]);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    await expect(
      store.revokeInvitation({ workspaceId: WORKSPACE_ID, invitationId: INVITATION_ID }),
    ).rejects.toMatchObject({ code: 'invitation_not_found' } satisfies Partial<AccountError>);
    expect(statements(session).at(-1)).toBe('ROLLBACK');
  });

  it('creates the actor and membership inside the inviting workspace', async () => {
    const session = new FakeSession([
      ...blanks(7),
      [],
      ...blanks(4),
      [invitationRow()],
      ...blanks(4),
      [{ id: IDENTITY_ID }],
      [],
      [actorRow({ id: INVITED_ACTOR_ID, external_ref: 'user_invited' })],
      [membershipRow({ actor_id: INVITED_ACTOR_ID, role: 'member' })],
      [invitationRow({ accepted_at: CREATED_AT })],
      [workspaceRow()],
      [teamRow()],
      [],
    ]);
    const store = new PostgresAccountStore(
      new FakeSource(session),
      vi.fn<() => string>().mockReturnValue(INVITED_ACTOR_ID),
    );

    const context = await store.redeemInvitation({
      subject: 'user_invited',
      verifiedEmail: INVITED_EMAIL,
      displayName: 'Grace Hopper',
      tokenHash: TOKEN_HASH,
    });

    expect(context?.workspace.id).toBe(WORKSPACE_ID);
    expect(context?.actor.id).toBe(INVITED_ACTOR_ID);
    expect(context?.membership.role).toBe('member');

    const lookup = session.calls.find(({ sql }) => sql.includes('FROM workspace_invitation'));
    expect(lookup?.params).toEqual([INVITED_EMAIL, TOKEN_HASH]);

    const scopeAtLookup = session.calls
      .slice(0, session.calls.indexOf(lookup as SqlCall))
      .filter(({ sql, params }) => sql.includes('set_config') && params.length === 2)
      .reduce<Record<string, string>>((scope, { params }) => {
        scope[String(params[0])] = String(params[1]);
        return scope;
      }, {});
    expect(scopeAtLookup['mneia.workspace_id']).toBe('');
    expect(scopeAtLookup['mneia.invitation_email']).toBe(INVITED_EMAIL);

    expect(scopeOf(session)['mneia.workspace_id']).toBe(WORKSPACE_ID);
    expect(statements(session).at(-1)).toBe('COMMIT');
  });

  it('leaves an existing actor alone rather than redeeming again', async () => {
    const session = new FakeSession([...blanks(7), [actorRow()], []]);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    await expect(
      store.redeemInvitation({
        subject: SUBJECT,
        verifiedEmail: INVITED_EMAIL,
        displayName: DISPLAY_NAME,
      }),
    ).resolves.toBeNull();
    expect(statements(session).some((sql) => sql.includes('workspace_invitation'))).toBe(false);
    expect(statements(session).at(-1)).toBe('COMMIT');
  });

  it('returns null when no pending invitation matches the verified email', async () => {
    const session = new FakeSession([...blanks(7), [], ...blanks(4), [], []]);
    const store = new PostgresAccountStore(new FakeSource(session), ids());

    await expect(
      store.redeemInvitation({
        subject: 'user_invited',
        verifiedEmail: INVITED_EMAIL,
        displayName: 'Grace Hopper',
      }),
    ).resolves.toBeNull();
    expect(statements(session).some((sql) => sql.includes('INSERT INTO actor'))).toBe(false);
    expect(statements(session).at(-1)).toBe('COMMIT');
  });
});
