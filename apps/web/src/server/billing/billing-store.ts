import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  WORKSPACE_SETTING,
} from '@mneia/core';
import type { BillingState } from './seats.js';
import { BillingError } from './stripe.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface BillingSnapshot extends BillingState {
  readonly workspaceId: string;
  readonly memberCount: number;
}

export interface BillingStore {
  readonly snapshot: (workspaceId: string) => Promise<BillingSnapshot | null>;
  readonly applyBillingState: (input: {
    readonly workspaceId: string;
    readonly state: BillingState;
  }) => Promise<BillingSnapshot>;
}

const assertUuid = (value: string, label: string): string => {
  if (!UUID_PATTERN.test(value)) {
    throw new BillingError(
      'invalid_payload',
      `expected ${label} to be a UUID; received "${value.slice(0, 60)}" — a Stripe event naming something that is not a workspace id is refused rather than looked up`,
    );
  }
  return value;
};

const readNumber = (row: SqlRow, column: string): number => Number(row[column] ?? 0);

const readNullableNumber = (row: SqlRow, column: string): number | null => {
  const value = row[column];
  return value === null || value === undefined ? null : Number(value);
};

const readText = (row: SqlRow, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string' || value.length === 0) {
    throw new BillingError(
      'invalid_payload',
      `expected ${column} on the workspace row to be a non-empty string; found ${String(value)}`,
    );
  }
  return value;
};

const readNullableText = (row: SqlRow, column: string): string | null => {
  const value = row[column];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

const toSnapshot = (row: SqlRow): BillingSnapshot => ({
  workspaceId: readText(row, 'workspace_id'),
  plan: readText(row, 'plan') as BillingSnapshot['plan'],
  billingStatus: readText(row, 'billing_status') as BillingSnapshot['billingStatus'],
  seatsPurchased: readNullableNumber(row, 'seats_purchased'),
  billingCustomerRef: readNullableText(row, 'billing_customer_ref'),
  memberCount: readNumber(row, 'member_count'),
});

const SNAPSHOT_SQL = `SELECT w.id                               AS workspace_id,
          w.plan,
          w.billing_status,
          w.seats_purchased,
          w.billing_customer_ref,
          (SELECT count(DISTINCT tm.actor_id)
             FROM team_member AS tm
            WHERE tm.workspace_id = w.id) AS member_count
     FROM workspace AS w
    WHERE w.id = $1`;

export class PostgresBillingStore implements BillingStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  private async withWorkspace<T>(
    workspaceId: string,
    run: (session: PostgresSession) => Promise<T>,
  ): Promise<T> {
    assertUuid(workspaceId, 'the workspace id');
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

  async snapshot(workspaceId: string): Promise<BillingSnapshot | null> {
    return this.withWorkspace(workspaceId, async (session) => {
      const { rows } = await session.execute<SqlRow>(SNAPSHOT_SQL, [workspaceId]);
      const row = rows[0];
      return row === undefined ? null : toSnapshot(row);
    });
  }

  async applyBillingState(input: {
    readonly workspaceId: string;
    readonly state: BillingState;
  }): Promise<BillingSnapshot> {
    const { workspaceId, state } = input;

    return this.withWorkspace(workspaceId, async (session) => {
      const updated = await session.execute<SqlRow>(
        `UPDATE workspace
            SET plan = $2,
                billing_status = $3,
                seats_purchased = $4,
                billing_customer_ref = $5
          WHERE id = $1
          RETURNING id`,
        [
          workspaceId,
          state.plan,
          state.billingStatus,
          state.seatsPurchased,
          state.billingCustomerRef,
        ],
      );

      if (updated.rows[0] === undefined) {
        throw new BillingError(
          'invalid_payload',
          `expected workspace ${workspaceId} to be visible when applying a billing state; found none. ` +
            'Either the workspace does not exist, or row-level security is hiding it because the Stripe event named a workspace this deployment does not own.',
        );
      }

      const { rows } = await session.execute<SqlRow>(SNAPSHOT_SQL, [workspaceId]);
      const row = rows[0];
      if (row === undefined) {
        throw new BillingError(
          'invalid_payload',
          `workspace ${workspaceId} disappeared between the billing update and reading it back`,
        );
      }
      return toSnapshot(row);
    });
  }
}
