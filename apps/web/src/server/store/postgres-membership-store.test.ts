import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type PostgresConnectionSource,
  type PostgresSession,
  RLS_POSTURE_SQL,
  type SqlResult,
  type SqlRow,
  type SqlValue,
  WORKSPACE_SETTING,
} from '@mneia/core';
import { PostgresMembershipStore } from './postgres-membership-store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const INVITATION_ID = '44444444-4444-4444-8444-444444444444';

const SCOPE = { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID } as const;

interface Exchange {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

type Responder = (sql: string, params: readonly SqlValue[]) => readonly SqlRow[] | undefined;

/**
 * A session that answers with canned rows and remembers every statement.
 *
 * `bypassesRls` exists so the RLS guard can be exercised: `assertConnectionEnforcesRls` is
 * what stops the application connecting as a role that can read every workspace, and a store
 * that skipped it would be invisible from the outside (§11.3).
 */
class FakeSession implements PostgresSession {
  readonly exchanges: Exchange[] = [];
  released = 0;
  discarded = 0;

  constructor(
    private readonly respond: Responder,
    private readonly bypassesRls = false,
  ) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    this.exchanges.push({ sql, params });
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
    return { rows: (this.respond(sql, params) ?? []) as unknown as readonly TRow[] };
  }

  async release(): Promise<void> {
    this.released += 1;
  }

  async discard(): Promise<void> {
    this.discarded += 1;
  }

  settingsBefore(fragment: string): Map<string, SqlValue> {
    const index = this.exchanges.findIndex((exchange) => exchange.sql.includes(fragment));
    const settings = new Map<string, SqlValue>();
    for (const exchange of this.exchanges.slice(0, index === -1 ? undefined : index)) {
      if (exchange.sql.includes('set_config')) {
        settings.set(String(exchange.params[0]), exchange.params[1] ?? '');
      }
    }
    return settings;
  }

  paramsFor(fragment: string): readonly SqlValue[] {
    return this.exchanges.find((exchange) => exchange.sql.includes(fragment))?.params ?? [];
  }

  sqlFor(fragment: string): string {
    return this.exchanges.find((exchange) => exchange.sql.includes(fragment))?.sql ?? '';
  }
}

const sourceOf = (session: PostgresSession): PostgresConnectionSource => ({
  acquire: async () => session,
  close: async () => {},
});

const storeWith = (respond: Responder, bypassesRls = false) => {
  const session = new FakeSession(respond, bypassesRls);
  return { session, store: new PostgresMembershipStore(sourceOf(session)) };
};

const SEAT_ROW: SqlRow = {
  plan: 'team',
  billing_status: 'active',
  seats_purchased: 5,
  member_count: '4',
  pending_invitations: '1',
};

describe('seatPosition', () => {
  it('reads the plan, the seats, the members and the live invitations', async () => {
    const { store } = storeWith((sql) => (sql.includes('pending_invitations') ? [SEAT_ROW] : []));

    expect(await store.seatPosition(SCOPE)).toEqual({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 5,
      memberCount: 4,
      pendingInvitations: 1,
    });
  });

  it('sets the workspace GUC before it reads anything, so RLS is what scopes the row', async () => {
    const { session, store } = storeWith((sql) =>
      sql.includes('pending_invitations') ? [SEAT_ROW] : [],
    );

    await store.seatPosition(SCOPE);

    expect(session.settingsBefore('pending_invitations').get(WORKSPACE_SETTING)).toBe(WORKSPACE_ID);
  });

  it('scopes every table in the query to the workspace, not only the workspace row', async () => {
    const { session, store } = storeWith((sql) =>
      sql.includes('pending_invitations') ? [SEAT_ROW] : [],
    );

    await store.seatPosition(SCOPE);
    const sql = session.sqlFor('pending_invitations');

    expect(sql).toContain('tm.workspace_id = w.id');
    expect(sql).toContain('wi.workspace_id = w.id');
    expect(session.paramsFor('pending_invitations')).toEqual([WORKSPACE_ID]);
  });

  it('ignores an expired invitation, which can never be accepted and so holds no seat', async () => {
    const { session, store } = storeWith((sql) =>
      sql.includes('pending_invitations') ? [SEAT_ROW] : [],
    );

    await store.seatPosition(SCOPE);

    expect(session.sqlFor('pending_invitations')).toContain('wi.expires_at > now()');
  });

  it('returns null when the workspace row is not visible, rather than inventing a position', async () => {
    const { store } = storeWith(() => []);

    expect(await store.seatPosition(SCOPE)).toBeNull();
  });

  it('refuses a connection that bypasses row-level security', async () => {
    const { session, store } = storeWith(() => [SEAT_ROW], true);

    await expect(store.seatPosition(SCOPE)).rejects.toThrow();
    expect(session.discarded).toBe(1);
    expect(session.released).toBe(0);
  });
});

describe('recordMembershipAudit', () => {
  it('writes the workspace and the actor from the scope, never from the event', async () => {
    const { session, store } = storeWith(() => []);

    await store.recordMembershipAudit(SCOPE, {
      action: 'membership.invitation_created',
      targetKind: 'workspace_invitation',
      targetId: INVITATION_ID,
      metadata: { role: 'member' },
    });

    const params = session.paramsFor('INSERT INTO audit_event');
    expect(params[1]).toBe(WORKSPACE_ID);
    expect(params[2]).toBe(ACTOR_ID);
    expect(params[3]).toBe('membership.invitation_created');
    expect(params[5]).toBe(INVITATION_ID);
    expect(params[6]).toBe(JSON.stringify({ role: 'member' }));
  });

  it('sets the workspace GUC before the insert, so the write cannot land in another tenant', async () => {
    const { session, store } = storeWith(() => []);

    await store.recordMembershipAudit(SCOPE, {
      action: 'membership.invitation_revoked',
      targetKind: 'workspace_invitation',
      targetId: INVITATION_ID,
      metadata: {},
    });

    expect(session.settingsBefore('INSERT INTO audit_event').get(WORKSPACE_SETTING)).toBe(
      WORKSPACE_ID,
    );
  });
});

describe('defaultTeamRole', () => {
  it('reads the role for the scoped actor in the default team', async () => {
    const { session, store } = storeWith((sql) =>
      sql.includes('default_team') ? [{ role: 'lead' }] : [],
    );

    expect(await store.defaultTeamRole(SCOPE)).toBe('lead');
    expect(session.paramsFor('default_team')).toEqual([WORKSPACE_ID, ACTOR_ID]);
  });

  it('returns null for a role the schema does not recognise, rather than trusting the string', async () => {
    const { store } = storeWith((sql) =>
      sql.includes('default_team') ? [{ role: 'owner-ish' }] : [],
    );

    expect(await store.defaultTeamRole(SCOPE)).toBeNull();
  });
});
