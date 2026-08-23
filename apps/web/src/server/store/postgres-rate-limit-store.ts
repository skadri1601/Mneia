import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  type SqlValue,
  WORKSPACE_SETTING,
} from '@mneia/core';
import type { RateLimitBucket } from '../rate-limit.js';
import { type BumpCountersInput, RateLimitError, type RateLimitStore } from './rate-limit-store.js';

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

const readBucket = (row: SqlRow): RateLimitBucket => {
  const value = row.bucket;
  if (value === 'requests') {
    return value;
  }
  throw new RateLimitError(
    'corrupt_counter',
    `expected rate_limit_counter.bucket to name a known bucket; received ${JSON.stringify(value)}`,
  );
};

const readCount = (row: SqlRow): number => {
  const value = row.count;
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isInteger(parsed)) return parsed;
  }
  throw new RateLimitError(
    'corrupt_counter',
    `expected rate_limit_counter.count to be an integer; received ${JSON.stringify(value)}`,
  );
};

export class PostgresRateLimitStore implements RateLimitStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async bump(input: BumpCountersInput): Promise<ReadonlyMap<RateLimitBucket, number>> {
    if (input.windows.length === 0) {
      return new Map();
    }

    const params: SqlValue[] = [input.workspaceId, input.discardBefore];
    const tuples = input.windows.map((window) => {
      const base = params.length;
      params.push(window.subject, window.bucket, window.windowStart);
      return `($1::uuid, $${base + 1}::text, $${base + 2}::text, $${base + 3}::timestamptz, 1)`;
    });

    const sql = `
WITH swept AS (
  DELETE FROM rate_limit_counter
  WHERE workspace_id = $1::uuid AND window_start < $2::timestamptz
)
INSERT INTO rate_limit_counter (workspace_id, subject, bucket, window_start, count)
VALUES ${tuples.join(', ')}
ON CONFLICT (workspace_id, subject, bucket, window_start)
DO UPDATE SET count = rate_limit_counter.count + 1
RETURNING bucket, count`;

    const rows = await this.inTransaction(input.workspaceId, async (session) => {
      const result = await session.execute<SqlRow>(sql, params);
      return result.rows;
    });

    return new Map(rows.map((row) => [readBucket(row), readCount(row)]));
  }

  async release(input: BumpCountersInput): Promise<void> {
    if (input.windows.length === 0) {
      return;
    }

    const params: SqlValue[] = [input.workspaceId];
    const predicates = input.windows.map((window) => {
      const base = params.length;
      params.push(window.subject, window.bucket, window.windowStart);
      return `(subject = $${base + 1}::text AND bucket = $${base + 2}::text AND window_start = $${base + 3}::timestamptz)`;
    });

    // GREATEST guards against a concurrent sweep having already removed the row's count;
    // a counter below zero would let the next window start with free headroom.
    const sql = `
UPDATE rate_limit_counter
   SET count = GREATEST(count - 1, 0)
 WHERE workspace_id = $1::uuid
   AND (${predicates.join(' OR ')})`;

    await this.inTransaction(input.workspaceId, async (session) => {
      await session.execute(sql, params);
    });
  }

  private async inTransaction<T>(
    workspaceId: string,
    operation: (session: PostgresSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.source.acquire();
    let transactionStarted = false;
    let discardSession = false;
    let completed = false;
    let result: T | undefined;
    let failure: unknown;

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      transactionStarted = true;
      await session.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
      result = await operation(session);
      await session.execute('COMMIT');
      transactionStarted = false;
      completed = true;
    } catch (error) {
      failure = error;
      if (transactionStarted) {
        try {
          await session.execute('ROLLBACK');
        } catch (rollbackError) {
          discardSession = true;
          failure = new RateLimitError(
            'rollback_failed',
            `bumping the rate limit counters failed with "${describeCause(error)}" and rolling back failed too`,
            { cause: new AggregateError([error, rollbackError]) },
          );
        }
      }
    }

    try {
      if (discardSession) {
        await session.discard();
      } else {
        await session.release();
      }
    } catch (cleanupError) {
      const causes = completed ? [cleanupError] : [failure, cleanupError];
      throw new RateLimitError(
        'session_cleanup_failed',
        `could not ${discardSession ? 'discard' : 'release'} the Postgres session after bumping the rate limit counters`,
        { cause: new AggregateError(causes) },
      );
    }

    if (!completed) throw failure;
    return result as T;
  }
}
