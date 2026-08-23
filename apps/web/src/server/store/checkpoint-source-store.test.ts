import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  type PostgresConnectionSource,
  type PostgresSession,
  RLS_POSTURE_SQL,
  type SqlResult,
  type SqlValue,
  WORKSPACE_SETTING,
} from '@mneia/core';
import type { ExtractionAttemptRecord } from '../api/propose.js';
import { CheckpointSourceStore, type UsageRecord } from './checkpoint-source-store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';

interface Exchange {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

/**
 * The balance the fake wallet holds, so the clamp can be exercised for real rather than
 * asserted against a hard-coded row.
 */
class FakeSession implements PostgresSession {
  readonly exchanges: Exchange[] = [];
  released = 0;
  discarded = 0;

  constructor(private balance: number) {}

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

    if (sql.includes('applied_micros')) {
      // Mirrors GREATEST(balance - requested, 0) and reports the movement that resulted,
      // which is the whole point of the RETURNING clause under test.
      const requested = Number(params[1] ?? 0);
      const after = Math.max(this.balance - requested, 0);
      const applied = this.balance - after;
      this.balance = after;
      return { rows: [{ applied_micros: applied } as TRow] };
    }

    return { rows: [] };
  }

  async release(): Promise<void> {
    this.released += 1;
  }

  async discard(): Promise<void> {
    this.discarded += 1;
  }

  statements(fragment: string): readonly Exchange[] {
    return this.exchanges.filter((exchange) => exchange.sql.includes(fragment));
  }

  only(fragment: string): Exchange {
    const found = this.statements(fragment);
    if (found.length !== 1) {
      throw new Error(
        `expected exactly one statement containing "${fragment}"; found ${found.length}`,
      );
    }
    return found[0] as Exchange;
  }
}

const sourceOf = (session: PostgresSession): PostgresConnectionSource => ({
  acquire: async () => session,
  close: async () => {},
});

/**
 * 1,000 input and 100 output tokens on gpt-5.6-luna.
 *
 * Flex is $0.10/M input and $0.60/M output, so 100 + 60 = 160 micros. Standard is exactly
 * double at 320, which is what makes the tier assertions unambiguous.
 */
const attempt = (overrides: Partial<ExtractionAttemptRecord> = {}): ExtractionAttemptRecord => ({
  model: 'gpt-5.6-luna',
  outcome: 'succeeded',
  inputTokens: 1_000,
  outputTokens: 100,
  durationMs: 12,
  serviceTier: 'flex',
  ...overrides,
});

const FLEX_MICROS = 160;

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  checkpointId: null,
  attempts: [attempt()],
  chargeableAttempts: 1,
  turns: 160,
  walletAuthorizationMicros: 10_000,
  ...overrides,
});

const storeWith = (balance: number) => {
  const session = new FakeSession(balance);
  return { session, store: new CheckpointSourceStore(sourceOf(session)) };
};

const debitAmount = (session: FakeSession): number =>
  Number(session.only('applied_micros').params[1]);

const ledgerAmount = (session: FakeSession): number =>
  Number(session.only('wallet_ledger').params[2]);

describe('CheckpointSourceStore.recordUsage', () => {
  it('proves the connection enforces RLS and scopes the workspace before writing', async () => {
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record());

    const posture = session.exchanges.findIndex((exchange) => exchange.sql === RLS_POSTURE_SQL);
    const begin = session.exchanges.findIndex((exchange) => exchange.sql.includes('BEGIN'));
    const scope = session.exchanges.findIndex((exchange) => exchange.sql.includes('set_config'));
    const insert = session.exchanges.findIndex((exchange) =>
      exchange.sql.includes('checkpoint_usage'),
    );

    expect(posture).toBeGreaterThanOrEqual(0);
    expect(begin).toBeGreaterThan(posture);
    expect(scope).toBeGreaterThan(begin);
    expect(scope).toBeLessThan(insert);
    expect(session.only('set_config').params[0]).toBe(WORKSPACE_SETTING);
  });

  it('debits the real cost of the attempt, not the pre-flight authorization', async () => {
    // The defect this exists to close: the authorization is estimateCostMicros against
    // ASSUMED_OUTPUT_TOKENS, which pricing.ts sizes generously. Settling it would charge
    // 10,000 micros for 160 micros of work.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record({ walletAuthorizationMicros: 10_000 }));

    expect(debitAmount(session)).toBe(FLEX_MICROS);
    expect(ledgerAmount(session)).toBe(FLEX_MICROS);
  });

  it('never charges past what the request was authorized for', async () => {
    // Reconciliation moves downwards only. If the completion ran long, or a fallback
    // vendor served it at five times the rate, we absorb the excess rather than charge
    // beyond the figure the checkpoint was admitted on.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record({ walletAuthorizationMicros: 100 }));

    expect(debitAmount(session)).toBe(100);
  });

  it('charges only the attempts belonging to committed chunks', async () => {
    // Chunk 2 died. The customer received chunk 1 and the watermark stops there, so one
    // attempt is chargeable while both are still recorded as our own cost.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(
      record({
        attempts: [attempt(), attempt({ outcome: 'failed', outputTokens: 0 })],
        chargeableAttempts: 1,
      }),
    );

    expect(session.statements('checkpoint_usage')).toHaveLength(2);
    expect(debitAmount(session)).toBe(FLEX_MICROS);
  });

  it('charges nothing when no chunk was committed at all', async () => {
    // A checkpoint that delivered nothing must not take money, even though we paid the
    // provider and still record the attempt against our own margin.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record({ chargeableAttempts: 0 }));

    expect(session.statements('checkpoint_usage')).toHaveLength(1);
    expect(session.statements('applied_micros')).toHaveLength(0);
    expect(session.statements('wallet_ledger')).toHaveLength(0);
  });

  it('does not touch the wallet when the checkpoint ran on allowance', async () => {
    // Standing rule 7: the individual tier is free, and a free workspace runs on
    // allowance, so a zero authorization has to make a debit impossible rather than small.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record({ walletAuthorizationMicros: 0 }));

    expect(session.statements('applied_micros')).toHaveLength(0);
    expect(session.statements('wallet_ledger')).toHaveLength(0);
    expect(session.statements('workspace_usage_period')).toHaveLength(1);
  });

  it('records in the ledger what was actually taken, not what was asked for', async () => {
    // The balance covers only part of the charge. Logging the requested figure is how a
    // balance and the sum of its own debits stop agreeing, after which neither can raise
    // an invoice or a refund.
    const { session, store } = storeWith(60);

    await store.recordUsage(record());

    expect(debitAmount(session)).toBe(FLEX_MICROS);
    expect(ledgerAmount(session)).toBe(60);
  });

  it('writes no ledger row when the balance was already empty', async () => {
    // wallet_ledger's amount_is_positive CHECK would reject a zero row, and a debit that
    // took nothing is not a debit.
    const { session, store } = storeWith(0);

    await store.recordUsage(record());

    expect(session.statements('applied_micros')).toHaveLength(1);
    expect(session.statements('wallet_ledger')).toHaveLength(0);
  });

  it('takes the row lock and reports the movement in a single statement', async () => {
    // The clamp has to stay atomic. A SELECT of the balance followed by an UPDATE would
    // let a concurrent debit land in between and reintroduce the lost update this shape
    // exists to prevent.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record());

    const debit = session.only('applied_micros');
    expect(debit.sql).toContain('FOR UPDATE');
    expect(debit.sql).toContain('GREATEST');
    expect(debit.sql).toContain('RETURNING');
    expect(session.statements('UPDATE workspace')).toHaveLength(1);
  });

  it('prices an attempt at the tier that actually served it', async () => {
    // Standard bills at exactly twice flex. Defaulting to the cheaper rate under-reports
    // the bill by half, which is the failure that cuts against our margin rather than the
    // customer.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record({ attempts: [attempt({ serviceTier: 'auto' })] }));

    expect(debitAmount(session)).toBe(FLEX_MICROS * 2);
    expect(Number(session.only('checkpoint_usage').params[8])).toBe(FLEX_MICROS * 2);
  });

  it('meters turns and extractions in the same transaction as the debit', async () => {
    // One transaction, so the meter, the ledger and the balance cannot disagree about
    // whether a checkpoint happened.
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record({ turns: 320 }));

    const period = session.only('workspace_usage_period');
    expect(period.params[1]).toBe(320);
    const commit = session.exchanges.findIndex((exchange) => exchange.sql.includes('COMMIT'));
    expect(session.exchanges.findIndex((e) => e.sql.includes('wallet_ledger'))).toBeLessThan(
      commit,
    );
  });

  it('writes nothing at all when no provider call was made', async () => {
    const { session, store } = storeWith(50_000);

    await store.recordUsage(record({ attempts: [], chargeableAttempts: 0 }));

    expect(session.exchanges).toHaveLength(0);
  });
});
