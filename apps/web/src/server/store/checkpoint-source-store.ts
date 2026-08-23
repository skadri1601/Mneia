import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  WORKSPACE_SETTING,
} from '@mneia/core';
import type { ExtractionAttemptRecord } from '../api/propose.js';
import { costMicrosFor } from '../billing/pricing.js';

export interface WatermarkQuery {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly source: string;
  readonly sessionRef: string;
}

export interface UsageRecord {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly checkpointId: string | null;
  /** Every attempt, committed or not — this is our cost accounting, failures included. */
  readonly attempts: readonly ExtractionAttemptRecord[];
  /**
   * How many of `attempts`, from the front, belong to chunks that were committed. Only
   * these are charged to the customer; see ProposeDependencies.recordUsage.
   */
  readonly chargeableAttempts: number;
  /** Turns consumed, which is what the turn dial meters. */
  readonly turns: number;
  /**
   * What the pre-flight check authorized against prepaid balance, or 0 for a checkpoint
   * that ran on allowance. A ceiling, not the charge — the real cost is priced here and
   * the smaller of the two is taken.
   */
  readonly walletAuthorizationMicros: number;
}

/**
 * What one attempt cost us, priced from the tokens the provider reported.
 *
 * Priced per attempt rather than apportioned from a total, because a fallback attempt runs
 * on a different vendor at five times the rate and splitting a total evenly would
 * misattribute which one was expensive. The tier is passed through rather than left to
 * default: standard bills at twice flex, and defaulting to the cheaper rate means any
 * caller that forgets under-reports the bill by half.
 */
const attemptCostMicros = (attempt: ExtractionAttemptRecord): number =>
  costMicrosFor({
    model: attempt.model,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    serviceTier: attempt.serviceTier,
  });

/**
 * Debit the wallet and report what was actually taken, in one statement.
 *
 * The CTE takes the row lock before the arithmetic, so this stays a single atomic
 * statement rather than a read-then-write: a concurrent debit blocks on the lock instead
 * of racing us. `GREATEST(… , 0)` keeps the balance off the floor set by the
 * `workspace_wallet_balance_is_not_negative` CHECK, and RETURNING the difference is what
 * lets the ledger record the movement that really happened. Logging the requested amount
 * instead is how a balance and the sum of its own debits stop agreeing, and after that
 * neither can be trusted to raise an invoice or a refund.
 */
const DEBIT_SQL = `WITH locked AS (
       SELECT id, wallet_balance_micros
         FROM workspace
        WHERE id = $1
          FOR UPDATE
     )
     UPDATE workspace AS w
        SET wallet_balance_micros = GREATEST(locked.wallet_balance_micros - $2, 0)
       FROM locked
      WHERE w.id = locked.id
  RETURNING locked.wallet_balance_micros - w.wallet_balance_micros AS applied_micros`;

const asText = (row: SqlRow | undefined, column: string): string | null => {
  const value = row?.[column];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export class CheckpointSourceStore {
  private readonly source: PostgresConnectionSource;

  constructor(source: PostgresConnectionSource) {
    this.source = source;
  }

  private async inScope<T>(
    workspaceId: string,
    run: (session: PostgresSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.source.acquire();
    let discard = false;

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      try {
        await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
        const result = await run(session);
        await session.execute('COMMIT');
        return result;
      } catch (error) {
        try {
          await session.execute('ROLLBACK');
        } catch {
          discard = true;
        }
        throw error;
      }
    } finally {
      if (discard) {
        await session.discard();
      } else {
        await session.release();
      }
    }
  }

  async watermarkFor(query: WatermarkQuery): Promise<string | null> {
    return this.inScope(query.workspaceId, async (session) => {
      const result = await session.execute<SqlRow>(
        `SELECT source_watermark
           FROM checkpoint
          WHERE workspace_id = $1
            AND project_id = $2
            AND source = $3
            AND source_session_ref = $4
            AND source_watermark IS NOT NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [query.workspaceId, query.projectId, query.source, query.sessionRef],
      );
      return asText(result.rows[0], 'source_watermark');
    });
  }

  async recordUsage(record: UsageRecord): Promise<void> {
    if (record.attempts.length === 0) {
      return;
    }

    await this.inScope(record.workspaceId, async (session) => {
      for (const attempt of record.attempts) {
        await session.execute(
          `INSERT INTO checkpoint_usage
             (id, workspace_id, checkpoint_id, model, input_tokens, output_tokens,
              duration_ms, outcome, cost_micros)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            randomUUID(),
            record.workspaceId,
            record.checkpointId,
            attempt.model,
            attempt.inputTokens,
            attempt.outputTokens,
            attempt.durationMs,
            attempt.outcome,
            attemptCostMicros(attempt),
          ],
        );
      }

      // One statement per period row, in the same transaction as the usage rows above, so
      // the meter and the ledger cannot disagree about what happened. checkpoints_used is
      // still maintained alongside the new dials: it is unread now, but keeping it correct
      // for a release means a rollback does not land on a counter frozen at the cutover.
      await session.execute(
        `INSERT INTO workspace_usage_period (
           workspace_id, period_start, checkpoints_used,
           turns_used, extractions_used
         )
         VALUES ($1, date_trunc('month', now())::date, 1, $2, 1)
         ON CONFLICT (workspace_id, period_start)
         DO UPDATE SET checkpoints_used = workspace_usage_period.checkpoints_used + 1,
                       turns_used = workspace_usage_period.turns_used + $2,
                       extractions_used = workspace_usage_period.extractions_used + 1,
                       updated_at = now()`,
        [record.workspaceId, Math.max(record.turns, 0)],
      );

      // The charge is the real cost of the chunks the customer actually received, capped
      // at what the pre-flight check authorized. Reconciling downwards only: the estimate
      // assumed a generous completion, so the real figure is nearly always smaller, and on
      // the rare occasion it is larger we absorb the excess rather than charge past what
      // the request was admitted for.
      const chargeable = record.attempts.slice(0, Math.max(record.chargeableAttempts, 0));
      const chargeMicros = Math.min(
        chargeable.reduce((total, attempt) => total + attemptCostMicros(attempt), 0),
        record.walletAuthorizationMicros,
      );

      if (chargeMicros > 0) {
        const debited = await session.execute<SqlRow>(DEBIT_SQL, [
          record.workspaceId,
          chargeMicros,
        ]);
        const applied = Number(debited.rows[0]?.applied_micros ?? 0);

        // A zero movement means the balance was already empty. wallet_ledger's
        // amount_is_positive CHECK would reject the row, and a debit that took nothing is
        // not a debit, so there is nothing to record.
        if (applied > 0) {
          await session.execute(
            `INSERT INTO wallet_ledger (id, workspace_id, kind, amount_micros, reason)
             VALUES ($1, $2, 'debit', $3, $4)`,
            [
              randomUUID(),
              record.workspaceId,
              applied,
              `checkpoint extraction in project ${record.projectId}`,
            ],
          );
        }
      }
    });
  }
}
