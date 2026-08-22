import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  WORKSPACE_SETTING,
} from '@mneia/core';
import { monthPeriod, type QuotaState } from './quota.js';
import { BillingError } from './stripe.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * One query, deliberately. Rehydrate holds a 300ms p95 budget (vision.md §12.1, standing
 * rule 4) and checkpoint shares the same connection pool, so the counters, the allowances,
 * the wallet and the member count are read together rather than as four round trips.
 *
 * The usage row is absent until the period's first checkpoint, hence the COALESCE: a
 * workspace that has not checkpointed this month has used nothing, not null.
 */
const QUOTA_SQL = `SELECT w.plan,
          w.billing_status,
          w.seats_purchased,
          w.turn_allowance,
          w.extraction_allowance,
          w.embedding_token_allowance,
          w.wallet_balance_micros,
          (SELECT count(DISTINCT tm.actor_id)
             FROM team_member AS tm
            WHERE tm.workspace_id = w.id) AS member_count,
          COALESCE(p.turns_used, 0) AS turns_used,
          COALESCE(p.extractions_used, 0) AS extractions_used,
          COALESCE(p.embedding_tokens_used, 0) AS embedding_tokens_used
     FROM workspace AS w
     LEFT JOIN workspace_usage_period AS p
            ON p.workspace_id = w.id
           AND p.period_start = date_trunc('month', $2::timestamptz)::date
    WHERE w.id = $1`;

export interface QuotaStore {
  readonly quotaFor: (workspaceId: string, now: Date) => Promise<QuotaState | null>;
}

const readCount = (row: SqlRow, column: string): number => {
  const value = Number(row[column] ?? 0);
  if (!Number.isInteger(value) || value < 0) {
    throw new BillingError(
      'invalid_payload',
      `expected ${column} to be a non-negative integer; received ${String(row[column])} — refusing to decide a quota from a count the database could not produce`,
    );
  }
  return value;
};

const readNullableCount = (row: SqlRow, column: string): number | null => {
  const value = row[column];
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BillingError(
      'invalid_payload',
      `expected ${column} to be a non-negative integer or null; received ${String(value)}`,
    );
  }
  return parsed;
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

export class PostgresQuotaStore implements QuotaStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  private async withWorkspace<T>(
    workspaceId: string,
    run: (session: PostgresSession) => Promise<T>,
  ): Promise<T> {
    if (!UUID_PATTERN.test(workspaceId)) {
      throw new BillingError(
        'invalid_payload',
        `expected the workspace id to be a UUID; received "${workspaceId.slice(0, 60)}"`,
      );
    }

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

  async quotaFor(workspaceId: string, now: Date): Promise<QuotaState | null> {
    const period = monthPeriod(now);

    return this.withWorkspace(workspaceId, async (session) => {
      const { rows } = await session.execute<SqlRow>(QUOTA_SQL, [
        workspaceId,
        period.start.toISOString(),
      ]);
      const row = rows[0];
      if (row === undefined) {
        return null;
      }

      return {
        plan: readText(row, 'plan') as QuotaState['plan'],
        billingStatus: readText(row, 'billing_status') as QuotaState['billingStatus'],
        seatsPurchased: readNullableCount(row, 'seats_purchased'),
        memberCount: readCount(row, 'member_count'),
        turnAllowance: readNullableCount(row, 'turn_allowance'),
        extractionAllowance: readNullableCount(row, 'extraction_allowance'),
        embeddingTokenAllowance: readNullableCount(row, 'embedding_token_allowance'),
        turnsUsed: readCount(row, 'turns_used'),
        extractionsUsed: readCount(row, 'extractions_used'),
        embeddingTokensUsed: readCount(row, 'embedding_tokens_used'),
        walletBalanceMicros: readCount(row, 'wallet_balance_micros'),
        period,
      };
    });
  }
}
