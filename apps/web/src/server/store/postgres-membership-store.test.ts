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

  allMatching(fragment: string): readonly Exchange[] {
    return this.exchanges.filter((exchange) => exchange.sql.includes(fragment));
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

const NEW_OWNER_ID = '88888888-8888-4888-8888-888888888888';
const NEW_IDENTITY_ID = '99999999-9999-4999-8999-999999999999';

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

const OTHER_ACTOR_ID = '55555555-5555-4555-8555-555555555555';
const IDENTITY_ID = '66666666-6666-4666-8666-666666666666';
const OTHER_IDENTITY_ID = '77777777-7777-4777-8777-777777777777';

interface MemberRowInput {
  readonly actorId: string;
  readonly identityId?: string | null;
  readonly displayName?: string;
  readonly workspaceRole?: string;
  readonly teamRole?: string;
  readonly kind?: string;
  readonly activeTokens?: number;
}

const memberRow = (input: MemberRowInput): SqlRow => ({
  actor_id: input.actorId,
  identity_id: input.identityId === undefined ? IDENTITY_ID : input.identityId,
  display_name: input.displayName ?? 'Ada',
  kind: input.kind ?? 'human',
  team_role: input.teamRole ?? 'lead',
  added_at: '2026-08-01T00:00:00.000Z',
  workspace_role: input.workspaceRole ?? 'owner',
  active_tokens: String(input.activeTokens ?? 0),
});

/** A store whose member query answers with `rows`, and whose writes answer with `writes`. */
const storeWithMembers = (rows: readonly SqlRow[], revokedTokenIds: readonly string[] = []) =>
  storeWith((sql) => {
    if (sql.includes('active_tokens')) return rows;
    if (sql.includes('UPDATE api_token')) return revokedTokenIds.map((id) => ({ id }));
    return [];
  });

describe('listMembers', () => {
  it('reads both roles, the actor kind, and the live token count', async () => {
    const { store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'admin', teamRole: 'lead', activeTokens: 3 }),
    ]);

    const members = await store.listMembers(SCOPE);

    expect(members).toHaveLength(1);
    expect(members[0]?.workspaceRole).toBe('admin');
    expect(members[0]?.teamRole).toBe('lead');
    expect(members[0]?.kind).toBe('human');
    expect(members[0]?.activeTokens).toBe(3);
  });

  it('reads the actor kind from the row, never from anything a caller supplied', async () => {
    const { store } = storeWithMembers([memberRow({ actorId: ACTOR_ID, kind: 'agent' })]);

    expect((await store.listMembers(SCOPE))[0]?.kind).toBe('agent');
  });

  it('falls back to the least privileged role when there is no workspace_member row', async () => {
    // An actor with no identity has no workspace_member row to join to. Defaulting to member
    // can only refuse a removal, never permit one that should have been refused.
    const { store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, identityId: null, workspaceRole: 'not-a-role' }),
    ]);

    expect((await store.listMembers(SCOPE))[0]?.workspaceRole).toBe('member');
  });

  it('scopes the member query to the workspace and sets the GUC first', async () => {
    const { session, store } = storeWithMembers([memberRow({ actorId: ACTOR_ID })]);

    await store.listMembers(SCOPE);

    expect(session.settingsBefore('active_tokens').get(WORKSPACE_SETTING)).toBe(WORKSPACE_ID);
    expect(session.paramsFor('active_tokens')).toEqual([WORKSPACE_ID]);
    expect(session.sqlFor('active_tokens')).toContain('tm.workspace_id = $1');
  });
});

describe('removeMember', () => {
  const twoOwners = [
    memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner', displayName: 'Ada' }),
    memberRow({
      actorId: OTHER_ACTOR_ID,
      identityId: OTHER_IDENTITY_ID,
      workspaceRole: 'member',
      teamRole: 'member',
      displayName: 'Grace',
      activeTokens: 2,
    }),
  ];

  it("revokes the removed member's tokens, scoped to that actor in that workspace", async () => {
    const { session, store } = storeWithMembers(twoOwners, ['tok-1', 'tok-2']);

    const result = await store.removeMember(SCOPE, { actorId: OTHER_ACTOR_ID });

    expect(result.removed).toBe(true);
    if (!result.removed) return;
    expect(result.tokensRevoked).toBe(2);
    expect(session.paramsFor('UPDATE api_token')).toEqual([WORKSPACE_ID, OTHER_ACTOR_ID]);
    expect(session.sqlFor('UPDATE api_token')).toContain('revoked_at IS NULL');
  });

  it('deletes the team membership, which is what frees the seat', async () => {
    const { session, store } = storeWithMembers(twoOwners);

    await store.removeMember(SCOPE, { actorId: OTHER_ACTOR_ID });

    expect(session.paramsFor('DELETE FROM team_member')).toEqual([WORKSPACE_ID, OTHER_ACTOR_ID]);
  });

  it('deletes the workspace membership by identity', async () => {
    const { session, store } = storeWithMembers(twoOwners);

    await store.removeMember(SCOPE, { actorId: OTHER_ACTOR_ID });

    expect(session.paramsFor('DELETE FROM workspace_member')).toEqual([
      WORKSPACE_ID,
      OTHER_IDENTITY_ID,
    ]);
  });

  it('never deletes the actor, the context items, or the checkpoints', async () => {
    // Fourteen tables carry a foreign key to actor, including context_item.asserted_by.
    // Removing a person must not remove the workspace's memory or break attribution.
    const { session, store } = storeWithMembers(twoOwners);

    await store.removeMember(SCOPE, { actorId: OTHER_ACTOR_ID });

    expect(session.allMatching('DELETE FROM actor')).toHaveLength(0);
    expect(session.allMatching('DELETE FROM context_item')).toHaveLength(0);
    expect(session.allMatching('DELETE FROM checkpoint')).toHaveLength(0);
    expect(session.allMatching('DELETE FROM handoff')).toHaveLength(0);
  });

  it('locks the owner rows before counting them, so two owners leaving cannot race', async () => {
    const { session, store } = storeWithMembers(twoOwners);

    await store.removeMember(SCOPE, { actorId: OTHER_ACTOR_ID });

    const lock = session.exchanges.findIndex((exchange) => exchange.sql.includes('FOR UPDATE'));
    const read = session.exchanges.findIndex((exchange) => exchange.sql.includes('active_tokens'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(read);
  });

  it('records the removal in the audit log with the counts, not the credentials', async () => {
    const { session, store } = storeWithMembers(twoOwners, ['tok-1', 'tok-2']);

    await store.removeMember(SCOPE, { actorId: OTHER_ACTOR_ID });

    const params = session.paramsFor('INSERT INTO audit_event');
    expect(params[3]).toBe('membership.member_removed');
    expect(params[4]).toBe('actor');
    expect(params[5]).toBe(OTHER_ACTOR_ID);
    expect(String(params[6])).toContain('"tokensRevoked":2');
    expect(String(params[6])).not.toContain('token_hash');
  });

  it('refuses to remove the last owner, and writes nothing at all', async () => {
    const { session, store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner' }),
    ]);

    const result = await store.removeMember(SCOPE, { actorId: ACTOR_ID });

    expect(result.removed).toBe(false);
    if (result.removed) return;
    expect(result.code).toBe('last_owner');
    expect(session.allMatching('DELETE FROM team_member')).toHaveLength(0);
    expect(session.allMatching('UPDATE api_token')).toHaveLength(0);
    expect(session.allMatching('INSERT INTO audit_event')).toHaveLength(0);
  });

  it('refuses a member removing an owner, and revokes no tokens', async () => {
    const { session, store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'member', teamRole: 'member' }),
      memberRow({
        actorId: OTHER_ACTOR_ID,
        identityId: OTHER_IDENTITY_ID,
        workspaceRole: 'owner',
      }),
      memberRow({ actorId: NEW_OWNER_ID, identityId: NEW_IDENTITY_ID, workspaceRole: 'owner' }),
    ]);

    const result = await store.removeMember(SCOPE, { actorId: OTHER_ACTOR_ID });

    expect(result.removed).toBe(false);
    if (result.removed) return;
    expect(result.code).toBe('not_permitted');
    expect(session.allMatching('UPDATE api_token')).toHaveLength(0);
  });

  it('refuses an actor id that is not a member of this workspace', async () => {
    const { session, store } = storeWithMembers(twoOwners);

    const result = await store.removeMember(SCOPE, { actorId: NEW_OWNER_ID });

    expect(result.removed).toBe(false);
    if (result.removed) return;
    expect(result.code).toBe('member_not_found');
    expect(session.allMatching('DELETE FROM team_member')).toHaveLength(0);
  });

  it('refuses a forged actor id without reaching the database', async () => {
    const { session, store } = storeWithMembers(twoOwners);

    const result = await store.removeMember(SCOPE, { actorId: "'; DROP TABLE actor; --" });

    expect(result.removed).toBe(false);
    if (result.removed) return;
    expect(result.code).toBe('member_not_found');
    expect(session.exchanges).toHaveLength(0);
  });

  it('reports a self removal, so the caller can redirect out of the workspace', async () => {
    const { store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner' }),
      memberRow({ actorId: OTHER_ACTOR_ID, identityId: OTHER_IDENTITY_ID, workspaceRole: 'owner' }),
    ]);

    const result = await store.removeMember(SCOPE, { actorId: ACTOR_ID });

    expect(result.removed).toBe(true);
    if (!result.removed) return;
    expect(result.selfRemoval).toBe(true);
  });
});

describe('changeRole', () => {
  const ownerAndMember = [
    memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner', displayName: 'Ada' }),
    memberRow({
      actorId: OTHER_ACTOR_ID,
      identityId: OTHER_IDENTITY_ID,
      workspaceRole: 'member',
      teamRole: 'member',
      displayName: 'Grace',
    }),
  ];

  it('writes the new workspace role for the target identity', async () => {
    const { session, store } = storeWithMembers(ownerAndMember);

    const result = await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'admin' });

    expect(result.changed).toBe(true);
    if (!result.changed) return;
    expect(result.previousRole).toBe('member');
    expect(result.newRole).toBe('admin');
    expect(session.paramsFor('UPDATE workspace_member')).toEqual([
      WORKSPACE_ID,
      OTHER_IDENTITY_ID,
      'admin',
    ]);
  });

  it('keeps team_member.role in step, or the promoted person could not invite anyone', async () => {
    // The app authorizes invitations, billing and project creation on team_member.role.
    const { session, store } = storeWithMembers(ownerAndMember);

    await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'owner' });

    expect(session.paramsFor('UPDATE team_member')).toEqual([WORKSPACE_ID, OTHER_ACTOR_ID, 'lead']);
  });

  it('demotes the team role too, so a demoted admin stops being a lead', async () => {
    const { session, store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner' }),
      memberRow({
        actorId: OTHER_ACTOR_ID,
        identityId: OTHER_IDENTITY_ID,
        workspaceRole: 'admin',
        teamRole: 'lead',
        displayName: 'Grace',
      }),
    ]);

    await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'member' });

    expect(session.paramsFor('UPDATE team_member')).toEqual([
      WORKSPACE_ID,
      OTHER_ACTOR_ID,
      'member',
    ]);
  });

  it('does not touch seats — no team_member row is added or removed', async () => {
    const { session, store } = storeWithMembers(ownerAndMember);

    await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'admin' });

    expect(session.allMatching('DELETE FROM team_member')).toHaveLength(0);
    expect(session.allMatching('INSERT INTO team_member')).toHaveLength(0);
    expect(session.allMatching('pending_invitations')).toHaveLength(0);
    expect(session.allMatching('seats_purchased')).toHaveLength(0);
  });

  it('records the privilege change, with both role systems and the direction', async () => {
    const { session, store } = storeWithMembers(ownerAndMember);

    await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'owner' });

    const params = session.paramsFor('INSERT INTO audit_event');
    expect(params[3]).toBe('membership.role_changed');
    expect(params[4]).toBe('actor');
    expect(params[5]).toBe(OTHER_ACTOR_ID);
    const metadata = String(params[6]);
    expect(metadata).toContain('"previousRole":"member"');
    expect(metadata).toContain('"newRole":"owner"');
    expect(metadata).toContain('"newTeamRole":"lead"');
    expect(metadata).toContain('"direction":"promotion"');
  });

  it('locks the owner rows before counting them', async () => {
    const { session, store } = storeWithMembers(ownerAndMember);

    await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'admin' });

    const lock = session.exchanges.findIndex((exchange) => exchange.sql.includes('FOR UPDATE'));
    const read = session.exchanges.findIndex((exchange) => exchange.sql.includes('active_tokens'));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(read);
  });

  it('refuses the sole owner demoting themselves, and writes nothing', async () => {
    const { session, store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner' }),
      memberRow({
        actorId: OTHER_ACTOR_ID,
        identityId: OTHER_IDENTITY_ID,
        workspaceRole: 'member',
        teamRole: 'member',
      }),
    ]);

    const result = await store.changeRole(SCOPE, { actorId: ACTOR_ID, role: 'admin' });

    expect(result.changed).toBe(false);
    if (result.changed) return;
    expect(result.code).toBe('last_owner');
    expect(session.allMatching('UPDATE workspace_member')).toHaveLength(0);
    expect(session.allMatching('INSERT INTO audit_event')).toHaveLength(0);
  });

  it('refuses a role the schema does not have, without reaching the database', async () => {
    const { session, store } = storeWithMembers(ownerAndMember);

    const result = await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'superuser' });

    expect(result.changed).toBe(false);
    if (result.changed) return;
    expect(result.code).toBe('not_permitted');
    expect(session.exchanges).toHaveLength(0);
  });

  it('refuses a forged actor id without reaching the database', async () => {
    const { session, store } = storeWithMembers(ownerAndMember);

    const result = await store.changeRole(SCOPE, { actorId: 'not-a-uuid', role: 'admin' });

    expect(result.changed).toBe(false);
    if (result.changed) return;
    expect(session.exchanges).toHaveLength(0);
  });

  it('refuses an actor with no identity, which has no workspace membership row to set', async () => {
    const { store } = storeWithMembers([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner' }),
      memberRow({
        actorId: OTHER_ACTOR_ID,
        identityId: null,
        kind: 'agent',
        workspaceRole: 'member',
        teamRole: 'member',
      }),
    ]);

    const result = await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'admin' });

    expect(result.changed).toBe(false);
    if (result.changed) return;
    expect(result.code).toBe('member_not_found');
  });
});

/**
 * A session that actually applies the writes, so two operations can be run in sequence and
 * the second sees the first. The canned-response fake above cannot express that, and the
 * whole point of the role change is that it unblocks a departure that was refused before it.
 */
class StatefulSession extends FakeSession {
  private members: SqlRow[];

  constructor(members: readonly SqlRow[]) {
    super(() => []);
    this.members = [...members];
  }

  override async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    if (sql.includes('active_tokens')) {
      await super.execute(sql, params);
      return { rows: [...this.members] as unknown as readonly TRow[] };
    }
    if (sql.includes('UPDATE workspace_member SET role')) {
      const identityId = params[1];
      const role = String(params[2]);
      this.members = this.members.map((row) =>
        row.identity_id === identityId
          ? { ...row, workspace_role: role, team_role: role === 'member' ? 'member' : 'lead' }
          : row,
      );
    }
    if (sql.includes('DELETE FROM team_member')) {
      const actorId = params[1];
      this.members = this.members.filter((row) => row.actor_id !== actorId);
    }
    return super.execute(sql, params);
  }
}

describe('promotion then departure, against a store that applies its own writes', () => {
  const sequence = () => {
    const session = new StatefulSession([
      memberRow({ actorId: ACTOR_ID, workspaceRole: 'owner', displayName: 'Ada' }),
      memberRow({
        actorId: OTHER_ACTOR_ID,
        identityId: OTHER_IDENTITY_ID,
        workspaceRole: 'member',
        teamRole: 'member',
        displayName: 'Grace',
      }),
    ]);
    return { session, store: new PostgresMembershipStore(sourceOf(session)) };
  };

  it('refuses the sole owner leaving, then permits it after they promote someone', async () => {
    const { store } = sequence();

    // Before: the sole owner cannot leave. This is the dead end round 2 left behind.
    const blocked = await store.removeMember(SCOPE, { actorId: ACTOR_ID });
    expect(blocked.removed).toBe(false);
    if (blocked.removed) return;
    expect(blocked.code).toBe('last_owner');

    // The move that opens the door.
    const promotion = await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'owner' });
    expect(promotion.changed).toBe(true);
    if (!promotion.changed) return;
    expect(promotion.newRole).toBe('owner');

    // After: the same call now succeeds, against the same store.
    const departure = await store.removeMember(SCOPE, { actorId: ACTOR_ID });
    expect(departure.removed).toBe(true);
    if (!departure.removed) return;
    expect(departure.selfRemoval).toBe(true);
    expect(departure.displayName).toBe('Ada');
  });

  it('leaves the promoted owner in place afterwards, so the workspace still has one', async () => {
    const { store } = sequence();

    await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'owner' });
    await store.removeMember(SCOPE, { actorId: ACTOR_ID });

    const remaining = await store.listMembers(SCOPE);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.actorId).toBe(OTHER_ACTOR_ID);
    expect(remaining[0]?.workspaceRole).toBe('owner');
    expect(remaining[0]?.teamRole).toBe('lead');
  });

  it('still refuses the last remaining owner leaving after the original has gone', async () => {
    const { store } = sequence();

    await store.changeRole(SCOPE, { actorId: OTHER_ACTOR_ID, role: 'owner' });
    await store.removeMember(SCOPE, { actorId: ACTOR_ID });

    const blocked = await store.removeMember(
      { workspaceId: WORKSPACE_ID, actorId: OTHER_ACTOR_ID },
      { actorId: OTHER_ACTOR_ID },
    );

    expect(blocked.removed).toBe(false);
    if (blocked.removed) return;
    expect(blocked.code).toBe('last_owner');
  });
});
