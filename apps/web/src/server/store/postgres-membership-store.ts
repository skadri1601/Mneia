import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  type TeamRole,
  WORKSPACE_SETTING,
  type WorkspaceScope,
} from '@mneia/core';
import type { SeatPosition } from '../billing/seats.js';

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
  recordMembershipAudit(scope: WorkspaceScope, event: MembershipAuditEvent): Promise<void>;
}

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
    | 'membership.invitation_accepted';
  readonly targetKind: 'workspace_invitation';
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
