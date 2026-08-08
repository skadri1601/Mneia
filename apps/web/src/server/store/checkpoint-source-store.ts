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
             (id, workspace_id, checkpoint_id, model, input_tokens, output_tokens, duration_ms, outcome)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            record.workspaceId,
            record.checkpointId,
            attempt.model,
            attempt.inputTokens,
            attempt.outputTokens,
            attempt.durationMs,
            attempt.outcome,
          ],
        );
      }
    });
  }
}
