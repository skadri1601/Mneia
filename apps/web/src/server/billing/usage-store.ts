import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type SqlRow,
  WORKSPACE_SETTING,
} from '@mneia/core';
import { database } from '../database.js';
import type { QuotaPeriod } from './quota.js';
import type { QuotaStore } from './quota-store.js';
import { quotaStore } from './runtime.js';
import { BillingError } from './stripe.js';
import { type UsageReport, usageReport } from './usage.js';

/**
 * A primary-key lookup on the period row the meter already maintains, so the checkpoint
 * count costs one indexed read rather than a scan of `checkpoint`. The period expression
 * is the one quota-store.ts uses, deliberately: reading the row with a different
 * expression would let the two disagree about which month a workspace is in.
 *
 * The row is absent until the period's first checkpoint, so no row means none.
 */
const CHECKPOINTS_SQL = `SELECT checkpoints_used
     FROM workspace_usage_period
    WHERE workspace_id = $1
      AND period_start = date_trunc('month', $2::timestamptz)::date`;

export interface UsageStore {
  readonly checkpointsIn: (workspaceId: string, period: QuotaPeriod) => Promise<number>;
}

const readCheckpoints = (row: SqlRow | undefined): number => {
  if (row === undefined) {
    return 0;
  }
  const value = Number(row.checkpoints_used ?? 0);
  if (!Number.isInteger(value) || value < 0) {
    throw new BillingError(
      'invalid_payload',
      `expected checkpoints_used to be a non-negative integer; received ${String(row.checkpoints_used)}`,
    );
  }
  return value;
};

export class PostgresUsageStore implements UsageStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async checkpointsIn(workspaceId: string, period: QuotaPeriod): Promise<number> {
    const session = await this.source.acquire();

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');

      try {
        await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
        const { rows } = await session.execute<SqlRow>(CHECKPOINTS_SQL, [
          workspaceId,
          period.start.toISOString(),
        ]);
        const checkpoints = readCheckpoints(rows[0]);
        await session.execute('COMMIT');
        await session.release();
        return checkpoints;
      } catch (error) {
        await session.execute('ROLLBACK');
        throw error;
      }
    } catch (error) {
      await session.discard().catch(() => undefined);
      throw error;
    }
  }
}

let store: UsageStore | undefined;

export const usageStore = (): UsageStore => {
  store ??= new PostgresUsageStore(database);
  return store;
};

export interface UsageDependencies {
  readonly quotas: QuotaStore;
  readonly usage: UsageStore;
  readonly now: () => Date;
}

/**
 * Null when the workspace row is absent. The caller is authenticated against it, so that is
 * a torn state rather than an unmetered one — reporting a zeroed solo plan instead would be
 * a number the customer could act on and we could not stand behind.
 */
export const loadUsageReport = async (
  workspaceId: string,
  dependencies: UsageDependencies = {
    quotas: quotaStore(),
    usage: usageStore(),
    now: () => new Date(),
  },
): Promise<UsageReport | null> => {
  const state = await dependencies.quotas.quotaFor(workspaceId, dependencies.now());
  if (state === null) {
    return null;
  }

  return usageReport(state, await dependencies.usage.checkpointsIn(workspaceId, state.period));
};
