import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  WORKSPACE_SETTING,
} from '@mneia/core';
import { costMicrosFor } from '../billing/pricing.js';
import type { ExtractionAttemptRecord } from '../api/propose.js';

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
  readonly attempts: readonly ExtractionAttemptRecord[];
  /** Turns consumed, which is what the turn dial meters. */
  readonly turns: number;
  /** Real cost of `attempts`, priced from their reported token counts. */
  readonly costMicros: number;
  /** Non-zero only when this checkpoint ran on wallet balance rather than allowance. */
  readonly walletDebitMicros: number;
}

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
            // Priced per attempt rather than apportioned from the total, because a
            // fallback attempt runs on a different vendor at five times the rate and
            // splitting the total evenly would misattribute which one was expensive.
            costMicrosFor({
              model: attempt.model,
              inputTokens: attempt.inputTokens,
              outputTokens: attempt.outputTokens,
            }),
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

      if (record.walletDebitMicros > 0) {
        // GREATEST guards the balance against going negative if a concurrent debit lands
        // between the quota check and here. Preferring a small unbilled overrun to a
        // negative balance is deliberate: the wallet is prepaid, so a negative number
        // would be money we never held.
        await session.execute(
          `UPDATE workspace
              SET wallet_balance_micros = GREATEST(wallet_balance_micros - $2, 0)
            WHERE id = $1`,
          [record.workspaceId, record.walletDebitMicros],
        );

        await session.execute(
          `INSERT INTO wallet_ledger (id, workspace_id, kind, amount_micros, reason)
           VALUES ($1, $2, 'debit', $3, $4)`,
          [
            randomUUID(),
            record.workspaceId,
            record.walletDebitMicros,
            `checkpoint extraction in project ${record.projectId}`,
          ],
        );
      }
    });
  }
}
