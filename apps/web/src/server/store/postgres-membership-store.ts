import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  ACTOR_KINDS,
  type ActorKind,
  assertConnectionEnforcesRls,
  TEAM_ROLES as CORE_TEAM_ROLES,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  type TeamRole,
  teamRoleForWorkspaceRole,
  WORKSPACE_ROLES,
  WORKSPACE_SETTING,
  type WorkspaceRole,
  type WorkspaceScope,
} from '@mneia/core';
import {
  decideRemoval,
  decideRoleChange,
  type RemovalRefusalCode,
  type RoleChangeRefusalCode,
  type SeatPosition,
  type WorkspaceMemberSummary,
} from '../billing/seats.js';

export interface MembershipStore {
  defaultTeamRole(scope: WorkspaceScope): Promise<TeamRole | null>;
}

/**
 * Reads and records that seat management needs, kept separate from `MembershipStore`.
 *
 * Separate because `MembershipStore` is a narrow port that call sites fake with an object
 * literal (see `apps/web/src/server/api/create-project.test.ts`); widening it would break
 * every such fake for callers that have no interest in seats.
 */
export interface SeatPositionStore {
  seatPosition(scope: WorkspaceScope): Promise<SeatPosition | null>;
  listMembers(scope: WorkspaceScope): Promise<readonly WorkspaceMemberSummary[]>;
  removeMember(scope: WorkspaceScope, input: RemoveMemberInput): Promise<MemberRemovalResult>;
  changeRole(scope: WorkspaceScope, input: ChangeRoleInput): Promise<RoleChangeResult>;
  recordMembershipAudit(scope: WorkspaceScope, event: MembershipAuditEvent): Promise<void>;
}

export interface RemoveMemberInput {
  /** The actor to remove. Validated as a UUID here because it arrives from a form. */
  readonly actorId: string;
}

export interface ChangeRoleInput {
  /** The actor whose role changes. Validated as a UUID here because it arrives from a form. */
  readonly actorId: string;
  /** Validated against `WORKSPACE_ROLES` here, for the same reason. */
  readonly role: string;
}

export type RoleChangeResult =
  | {
      readonly changed: true;
      readonly displayName: string;
      readonly previousRole: WorkspaceRole;
      readonly newRole: WorkspaceRole;
      readonly selfChange: boolean;
      readonly direction: 'promotion' | 'demotion';
    }
  | { readonly changed: false; readonly code: RoleChangeRefusalCode; readonly message: string };

export type MemberRemovalResult =
  | {
      readonly removed: true;
      readonly displayName: string;
      readonly tokensRevoked: number;
      readonly selfRemoval: boolean;
    }
  | { readonly removed: false; readonly code: RemovalRefusalCode; readonly message: string };

/**
 * An administrative write worth a durable record.
 *
 * `audit_event` rather than the §17 telemetry spine: `TELEMETRY_EVENT_NAMES` names no
 * membership or seat event, and `TelemetryContext` requires a `projectId` that membership
 * changes do not have. That is the same reasoning `packages/core/src/telemetry/coverage.test.ts`
 * records for exempting `createProject` — control plane, not the product loop. `audit_event`
 * (migration 0028) is the table built for exactly this and had no writer before now.
 *
 * `actorId` comes from the resolved scope, never from a request payload, so the recorded
 * author is whoever the database says is signed in.
 */
export interface MembershipAuditEvent {
  readonly action:
    | 'membership.invitation_created'
    | 'membership.invitation_revoked'
    | 'membership.invitation_accepted'
    | 'membership.member_removed'
    | 'membership.role_changed';
  readonly targetKind: 'workspace_invitation' | 'actor';
  readonly targetId: string | null;
  /**
   * Counts and roles only. Never the join token, and never the invited address — the token
   * is a credential and the address is user content; both are already on
   * `workspace_invitation`, which is workspace-scoped and reachable by anyone entitled to
   * read this row.
   */
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

const TEAM_ROLES: ReadonlySet<string> = new Set(['lead', 'member']);

const readCount = (row: SqlRow, column: string): number => Number(row[column] ?? 0);

const readNullableCount = (row: SqlRow, column: string): number | null => {
  const value = row[column];
  return value === null || value === undefined ? null : Number(value);
};

const readText = (row: SqlRow, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `expected ${column} on the workspace row to be a non-empty string; received ${String(value)} — ` +
        'the seat position cannot be decided from a workspace row this deployment cannot read',
    );
  }
  return value;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readOptionalText = (row: SqlRow, column: string): string | null => {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const readDate = (row: SqlRow, column: string): Date => {
  const value = row[column];
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new Error(
    `expected ${column} on a member row to be a timestamp; received ${typeof value} - the member list ` +
      'is refused rather than shown with an invented join date',
  );
};

const readEnum = <T extends string>(
  row: SqlRow,
  column: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  const value = row[column];
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
};

/**
 * Everyone in the workspace, with both roles and what removal would revoke.
 *
 * The join to `workspace_member` is a LEFT JOIN and the role falls back to `member`: an
 * `actor` row may have no `identity_id` at all (agent actors, and human rows created before
 * migration 0030 backfilled identities), so there is no `workspace_member` row to find for
 * those. Defaulting the unknown case to the *least* privileged role is the safe direction -
 * it can only ever refuse a removal, never permit one that should have been refused.
 */
const MEMBERS_SQL = `SELECT a.id                AS actor_id,
          a.identity_id,
          a.display_name,
          a.kind,
          tm.role              AS team_role,
          tm.added_at,
          COALESCE(wm.role::text, 'member') AS workspace_role,
          (SELECT count(*)
             FROM api_token AS t
            WHERE t.workspace_id = tm.workspace_id
              AND t.actor_id = a.id
              AND t.revoked_at IS NULL
              AND (t.expires_at IS NULL OR t.expires_at > now())) AS active_tokens
     FROM team_member AS tm
     INNER JOIN actor AS a
             ON a.workspace_id = tm.workspace_id
            AND a.id = tm.actor_id
     LEFT JOIN workspace_member AS wm
            ON wm.workspace_id = tm.workspace_id
           AND wm.identity_id = a.identity_id
    WHERE tm.workspace_id = $1
    ORDER BY tm.added_at ASC, a.display_name ASC`;

const toMember = (row: SqlRow): WorkspaceMemberSummary => ({
  actorId: readText(row, 'actor_id'),
  identityId: readOptionalText(row, 'identity_id'),
  displayName: readText(row, 'display_name'),
  kind: readEnum<ActorKind>(row, 'kind', ACTOR_KINDS, 'agent'),
  workspaceRole: readEnum<WorkspaceRole>(row, 'workspace_role', WORKSPACE_ROLES, 'member'),
  teamRole: readEnum<TeamRole>(row, 'team_role', CORE_TEAM_ROLES, 'member'),
  addedAt: readDate(row, 'added_at'),
  activeTokens: readCount(row, 'active_tokens'),
});

/**
 * Members, seats, and live invitations in one round trip.
 *
 * `expires_at > now()` matters: an expired invitation can never be accepted, so it holds no
 * seat and must not count against one. Note this is stricter than
 * `PostgresAccountStore.listPendingInvitations`, which filters only on accepted/revoked and
 * therefore still lists invitations nobody can redeem.
 */
const SEAT_POSITION_SQL = `SELECT w.plan,
          w.billing_status,
          w.seats_purchased,
          (SELECT count(DISTINCT tm.actor_id)
             FROM team_member AS tm
            WHERE tm.workspace_id = w.id) AS member_count,
          (SELECT count(*)
             FROM workspace_invitation AS wi
            WHERE wi.workspace_id = w.id
              AND wi.accepted_at IS NULL
              AND wi.revoked_at IS NULL
              AND wi.expires_at > now()) AS pending_invitations
     FROM workspace AS w
    WHERE w.id = $1`;

export class PostgresMembershipStore implements MembershipStore, SeatPositionStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  /**
   * One workspace-scoped transaction, with the `mneia.workspace_id` GUC set before any query.
   *
   * A failed ROLLBACK leaves the connection in an unknown transaction state, so it is
   * discarded rather than released back to the pool — the same shape `postgres-billing-store.ts`
   * and `postgres-quota-store.ts` already use.
   */
  private async withWorkspace<T>(
    workspaceId: string,
    run: (session: PostgresSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.source.acquire();

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');

      try {
        await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
        const result = await run(session);
        await session.execute('COMMIT');
        await session.release();
        return result;
      } catch (error) {
        await session.execute('ROLLBACK');
        throw error;
      }
    } catch (error) {
      await session.discard().catch(() => undefined);
      throw error;
    }
  }

  async defaultTeamRole(scope: WorkspaceScope): Promise<TeamRole | null> {
    return this.withWorkspace(scope.workspaceId, async (session) => {
      const result = await session.execute<SqlRow>(
        `SELECT membership.role
           FROM team_member AS membership
           INNER JOIN team AS default_team
             ON default_team.workspace_id = membership.workspace_id
            AND default_team.id = membership.team_id
          WHERE membership.workspace_id = $1
            AND membership.actor_id = $2
            AND default_team.slug = 'default'
          LIMIT 1`,
        [scope.workspaceId, scope.actorId],
      );

      const role = result.rows[0]?.role;
      return typeof role === 'string' && TEAM_ROLES.has(role) ? (role as TeamRole) : null;
    });
  }

  async seatPosition(scope: WorkspaceScope): Promise<SeatPosition | null> {
    return this.withWorkspace(scope.workspaceId, async (session) => {
      const { rows } = await session.execute<SqlRow>(SEAT_POSITION_SQL, [scope.workspaceId]);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }

      return {
        plan: readText(row, 'plan') as SeatPosition['plan'],
        billingStatus: readText(row, 'billing_status') as SeatPosition['billingStatus'],
        seatsPurchased: readNullableCount(row, 'seats_purchased'),
        memberCount: readCount(row, 'member_count'),
        pendingInvitations: readCount(row, 'pending_invitations'),
      };
    });
  }

  async listMembers(scope: WorkspaceScope): Promise<readonly WorkspaceMemberSummary[]> {
    return this.withWorkspace(scope.workspaceId, async (session) => {
      const { rows } = await session.execute<SqlRow>(MEMBERS_SQL, [scope.workspaceId]);
      return rows.map(toMember);
    });
  }

  /**
   * Remove a member, revoke their credentials, and record it - in one transaction.
   *
   * Read, decide, and act are deliberately not split across calls. The last-owner guard is
   * only meaningful if the owner count cannot change between counting it and deleting the
   * row, so the owner rows are locked `FOR UPDATE` before the count is taken: two owners
   * leaving concurrently then serialize, and the second is refused rather than both
   * succeeding and orphaning the workspace.
   *
   * **What is deleted:** the `team_member` row - which is what releases the seat, because
   * `member_count` is a count over `team_member` - and the `workspace_member` row.
   *
   * **What is kept: the `actor` row, and everything hanging off it.** That is not a
   * convenience, it is required. Fourteen tables carry a foreign key to
   * `actor (workspace_id, id)`, including `context_item.asserted_by`, `checkpoint.actor_id`,
   * `handoff.from_actor` / `to_actor` and `conflict.resolved_by`. Deleting the actor would
   * either fail on those constraints or destroy the workspace's project memory and every
   * attribution in it. A removed person keeps their name on the work they did and
   * `asserted_by` still resolves; they simply have no membership and no credentials.
   */
  async removeMember(
    scope: WorkspaceScope,
    input: RemoveMemberInput,
  ): Promise<MemberRemovalResult> {
    if (!UUID_PATTERN.test(input.actorId)) {
      return {
        removed: false,
        code: 'member_not_found',
        message:
          `expected the member to be identified by a UUID; received "${input.actorId.slice(0, 60)}" - ` +
          'nobody was removed',
      };
    }

    return this.withWorkspace(scope.workspaceId, async (session) => {
      // Lock the owner rows first, so the count taken below cannot change under us.
      await session.execute(
        `SELECT 1 FROM workspace_member
          WHERE workspace_id = $1 AND role = 'owner'::workspace_role
          FOR UPDATE`,
        [scope.workspaceId],
      );

      const { rows } = await session.execute<SqlRow>(MEMBERS_SQL, [scope.workspaceId]);
      const members = rows.map(toMember);
      const ownerCount = members.filter((member) => member.workspaceRole === 'owner').length;
      const target = members.find((member) => member.actorId === input.actorId);
      const remover = members.find((member) => member.actorId === scope.actorId);

      if (target === undefined) {
        return {
          removed: false,
          code: 'member_not_found',
          message:
            `expected a member of this workspace with actor id ${input.actorId}; found none - ` +
            'they may already have been removed',
        };
      }
      if (remover === undefined) {
        return {
          removed: false,
          code: 'not_permitted',
          message:
            'expected the signed-in account to be a member of this workspace before it removes anyone; ' +
            'it is not a member of it',
        };
      }

      const decision = decideRemoval({
        remover: {
          actorId: remover.actorId,
          workspaceRole: remover.workspaceRole,
          displayName: remover.displayName,
        },
        target: {
          actorId: target.actorId,
          workspaceRole: target.workspaceRole,
          displayName: target.displayName,
        },
        ownerCount,
      });

      if (!decision.permitted) {
        return { removed: false, code: decision.code, message: decision.message };
      }

      // Credentials first. If anything below fails, the whole transaction rolls back, so the
      // membership and the tokens can never disagree about whether this person has access.
      const revoked = await session.execute<SqlRow>(
        `UPDATE api_token SET revoked_at = now()
          WHERE workspace_id = $1 AND actor_id = $2 AND revoked_at IS NULL
          RETURNING id`,
        [scope.workspaceId, target.actorId],
      );

      await session.execute('DELETE FROM team_member WHERE workspace_id = $1 AND actor_id = $2', [
        scope.workspaceId,
        target.actorId,
      ]);

      if (target.identityId !== null) {
        await session.execute(
          'DELETE FROM workspace_member WHERE workspace_id = $1 AND identity_id = $2',
          [scope.workspaceId, target.identityId],
        );
      }

      await session.execute(
        `INSERT INTO audit_event (id, workspace_id, actor_id, action, target_kind, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          scope.workspaceId,
          scope.actorId,
          'membership.member_removed',
          'actor',
          target.actorId,
          JSON.stringify({
            workspaceRole: target.workspaceRole,
            teamRole: target.teamRole,
            tokensRevoked: revoked.rows.length,
            selfRemoval: decision.selfRemoval,
            ownerCountBefore: ownerCount,
          }),
        ],
      );

      return {
        removed: true,
        displayName: target.displayName,
        tokensRevoked: revoked.rows.length,
        selfRemoval: decision.selfRemoval,
      };
    });
  }

  /**
   * Set a member's workspace role, and record it - in one transaction.
   *
   * Same shape as `removeMember`, for the same reason: the last-owner invariant is only
   * meaningful if the owner count cannot change between counting it and writing, so the
   * owner rows are locked `FOR UPDATE` first. A sole owner promoting someone and a
   * concurrent demotion then serialize rather than both succeeding against a stale count.
   *
   * **Both role tables are written.** `workspace_member.role` is the fine-grained authority,
   * but the app authorizes invitations, billing and project creation on
   * `team_member.role === 'lead'` - so promoting someone to owner while leaving their team
   * role at `member` would produce an owner who cannot invite anybody. `teamRoleForWorkspaceRole`
   * is the single mapping between them and is applied here rather than re-derived.
   *
   * **Seats are untouched.** No `team_member` row is added or removed, and `member_count` is
   * a count over `team_member`, so the seat position is unchanged by construction and no
   * Stripe sync is warranted. There is a test asserting this method issues no seat query.
   */
  async changeRole(scope: WorkspaceScope, input: ChangeRoleInput): Promise<RoleChangeResult> {
    if (!UUID_PATTERN.test(input.actorId)) {
      return {
        changed: false,
        code: 'member_not_found',
        message:
          `expected the member to be identified by a UUID; received "${input.actorId.slice(0, 60)}" - ` +
          'no role was changed',
      };
    }

    if (!(WORKSPACE_ROLES as readonly string[]).includes(input.role)) {
      return {
        changed: false,
        code: 'not_permitted',
        message:
          `expected the new role to be one of ${WORKSPACE_ROLES.join(', ')}; received "${input.role.slice(0, 60)}" - ` +
          'no role was changed',
      };
    }
    const newRole = input.role as WorkspaceRole;

    return this.withWorkspace(scope.workspaceId, async (session) => {
      await session.execute(
        `SELECT 1 FROM workspace_member
          WHERE workspace_id = $1 AND role = 'owner'::workspace_role
          FOR UPDATE`,
        [scope.workspaceId],
      );

      const { rows } = await session.execute<SqlRow>(MEMBERS_SQL, [scope.workspaceId]);
      const members = rows.map(toMember);
      const ownerCount = members.filter((member) => member.workspaceRole === 'owner').length;
      const target = members.find((member) => member.actorId === input.actorId);
      const actor = members.find((member) => member.actorId === scope.actorId);

      if (target === undefined) {
        return {
          changed: false,
          code: 'member_not_found',
          message: `expected a member of this workspace with actor id ${input.actorId}; found none`,
        };
      }
      if (actor === undefined) {
        return {
          changed: false,
          code: 'not_permitted',
          message:
            'expected the signed-in account to be a member of this workspace before it changes a role; ' +
            'it is not a member of it',
        };
      }
      if (target.identityId === null) {
        return {
          changed: false,
          code: 'member_not_found',
          message:
            `expected ${target.displayName} to have an identity and therefore a workspace membership row to change; ` +
            'this actor has neither, so it has no workspace role to set',
        };
      }

      const decision = decideRoleChange({
        actor: {
          actorId: actor.actorId,
          workspaceRole: actor.workspaceRole,
          displayName: actor.displayName,
        },
        target: {
          actorId: target.actorId,
          workspaceRole: target.workspaceRole,
          displayName: target.displayName,
        },
        newRole,
        ownerCount,
      });

      if (!decision.permitted) {
        return { changed: false, code: decision.code, message: decision.message };
      }

      await session.execute(
        `UPDATE workspace_member SET role = $3::workspace_role
          WHERE workspace_id = $1 AND identity_id = $2`,
        [scope.workspaceId, target.identityId, newRole],
      );

      // Kept in step deliberately - see the note above about `team_member.role === 'lead'`.
      await session.execute(
        `UPDATE team_member SET role = $3::team_role
          WHERE workspace_id = $1 AND actor_id = $2`,
        [scope.workspaceId, target.actorId, teamRoleForWorkspaceRole(newRole)],
      );

      await session.execute(
        `INSERT INTO audit_event (id, workspace_id, actor_id, action, target_kind, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          scope.workspaceId,
          scope.actorId,
          'membership.role_changed',
          'actor',
          target.actorId,
          JSON.stringify({
            previousRole: target.workspaceRole,
            newRole,
            previousTeamRole: target.teamRole,
            newTeamRole: teamRoleForWorkspaceRole(newRole),
            direction: decision.direction,
            selfChange: decision.selfChange,
            ownerCountBefore: ownerCount,
          }),
        ],
      );

      return {
        changed: true,
        displayName: target.displayName,
        previousRole: target.workspaceRole,
        newRole,
        selfChange: decision.selfChange,
        direction: decision.direction,
      };
    });
  }

  async recordMembershipAudit(scope: WorkspaceScope, event: MembershipAuditEvent): Promise<void> {
    await this.withWorkspace(scope.workspaceId, async (session) => {
      await session.execute(
        `INSERT INTO audit_event (id, workspace_id, actor_id, action, target_kind, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [
          randomUUID(),
          scope.workspaceId,
          scope.actorId,
          event.action,
          event.targetKind,
          event.targetId,
          JSON.stringify(event.metadata),
        ],
      );
    });
  }
}
