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
import { monthPeriod, type QuotaState } from './quota.js';
import type { QuotaStore } from './quota-store.js';
import { BillingError } from './stripe.js';
import { loadUsageReport, PostgresUsageStore, type UsageStore } from './usage-store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-16T12:00:00.000Z');
const PERIOD = monthPeriod(NOW);

interface Exchange {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

type Responder = (sql: string, params: readonly SqlValue[]) => readonly SqlRow[] | undefined;

class FakeSession implements PostgresSession {
  readonly exchanges: Exchange[] = [];
  released = 0;
  discarded = 0;

  constructor(private readonly respond: Responder) {}

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
            role_bypasses_rls: false,
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

  indexOf(fragment: string): number {
    return this.exchanges.findIndex((exchange) => exchange.sql.includes(fragment));
  }
}

const sourceOf = (session: PostgresSession): PostgresConnectionSource => ({
  acquire: async () => session,
  close: async () => {},
});

const storeWith = (respond: Responder): { session: FakeSession; store: PostgresUsageStore } => {
  const session = new FakeSession(respond);
  return { session, store: new PostgresUsageStore(sourceOf(session)) };
};

const countRow = (): readonly SqlRow[] => [{ checkpoints_used: 17 }];

describe('PostgresUsageStore.checkpointsIn', () => {
  it('reads the count from the period row', async () => {
    const { store } = storeWith(countRow);

    await expect(store.checkpointsIn(WORKSPACE_ID, PERIOD)).resolves.toBe(17);
  });

  // Without the GUC the row is invisible to the isolation policy, so a missing set_config
  // reads as "no checkpoints" rather than failing — the quietest possible way to be wrong.
  it('sets the workspace GUC before it reads, inside a transaction', async () => {
    const { session, store } = storeWith(countRow);

    await store.checkpointsIn(WORKSPACE_ID, PERIOD);

    const begin = session.indexOf('BEGIN');
    const guc = session.exchanges.findIndex((exchange) =>
      exchange.params.includes(WORKSPACE_SETTING),
    );
    const read = session.indexOf('workspace_usage_period');

    expect(begin).toBeGreaterThanOrEqual(0);
    expect(guc).toBeGreaterThan(begin);
    expect(read).toBeGreaterThan(guc);
    expect(session.exchanges[guc]?.params).toEqual([WORKSPACE_SETTING, WORKSPACE_ID]);
  });

  it('checks the RLS posture before it trusts the connection', async () => {
    const { session, store } = storeWith(countRow);

    await store.checkpointsIn(WORKSPACE_ID, PERIOD);

    expect(session.exchanges[0]?.sql).toBe(RLS_POSTURE_SQL);
  });

  it('scopes the read to the period the quota store uses', async () => {
    const { session, store } = storeWith(countRow);

    await store.checkpointsIn(WORKSPACE_ID, PERIOD);

    const read = session.exchanges[session.indexOf('workspace_usage_period')];
    expect(read?.sql).toContain(`date_trunc('month', $2::timestamptz)::date`);
    expect(read?.params).toEqual([WORKSPACE_ID, PERIOD.start.toISOString()]);
  });

  // The period row is absent until the period's first checkpoint.
  it('reports none when the period row does not exist yet', async () => {
    const { store } = storeWith(() => []);

    await expect(store.checkpointsIn(WORKSPACE_ID, PERIOD)).resolves.toBe(0);
  });

  it('refuses a count the database could not have produced', async () => {
    const { store } = storeWith(() => [{ checkpoints_used: -4 }]);

    await expect(store.checkpointsIn(WORKSPACE_ID, PERIOD)).rejects.toBeInstanceOf(BillingError);
  });

  it('commits and releases the session on the happy path', async () => {
    const { session, store } = storeWith(countRow);

    await store.checkpointsIn(WORKSPACE_ID, PERIOD);

    expect(session.indexOf('COMMIT')).toBeGreaterThan(0);
    expect(session.released).toBe(1);
    expect(session.discarded).toBe(0);
  });

  it('rolls back and discards the session when the read fails', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('workspace_usage_period')) {
        throw new Error('connection reset');
      }
      return [];
    });

    await expect(store.checkpointsIn(WORKSPACE_ID, PERIOD)).rejects.toThrow('connection reset');
    expect(session.indexOf('ROLLBACK')).toBeGreaterThan(0);
    expect(session.discarded).toBe(1);
  });
});

const quotaState = (overrides: Partial<QuotaState> = {}): QuotaState => ({
  plan: 'pro',
  billingStatus: 'active',
  seatsPurchased: null,
  memberCount: 1,
  turnAllowance: null,
  extractionAllowance: 1_000,
  embeddingTokenAllowance: null,
  turnsUsed: 0,
  extractionsUsed: 850,
  embeddingTokensUsed: 0,
  walletBalanceMicros: 0,
  period: PERIOD,
  ...overrides,
});

const quotas = (state: QuotaState | null): QuotaStore => ({
  quotaFor: async () => state,
});

const usage = (checkpoints: number): UsageStore => ({
  checkpointsIn: async () => checkpoints,
});

describe('loadUsageReport', () => {
  it('meters the quota state against the checkpoint count for the same period', async () => {
    const report = await loadUsageReport(WORKSPACE_ID, {
      quotas: quotas(quotaState()),
      usage: usage(42),
      now: () => NOW,
    });

    expect(report?.checkpoints).toBe(42);
    expect(report?.percentUsed).toBe(85);
    expect(report?.warn).toBe(true);
  });

  it('counts against the period the quota state reports, not a second clock reading', async () => {
    const seen: QuotaState['period'][] = [];

    await loadUsageReport(WORKSPACE_ID, {
      quotas: quotas(quotaState()),
      usage: {
        checkpointsIn: async (_workspaceId, period) => {
          seen.push(period);
          return 0;
        },
      },
      now: () => NOW,
    });

    expect(seen).toEqual([PERIOD]);
  });

  // The caller is authenticated against the workspace, so a missing row is a torn state.
  // Reporting a zeroed solo plan instead would be a number we could not stand behind.
  it('returns null when the workspace has no row to meter', async () => {
    await expect(
      loadUsageReport(WORKSPACE_ID, {
        quotas: quotas(null),
        usage: usage(9),
        now: () => NOW,
      }),
    ).resolves.toBeNull();
  });
});
