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
import { PostgresQuotaStore } from './quota-store.js';
import { BillingError } from './stripe.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-08-16T12:00:00.000Z');

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

const ROW: SqlRow = {
  plan: 'team',
  billing_status: 'active',
  seats_purchased: 4,
  turn_allowance: 200_000,
  extraction_allowance: 1_250,
  embedding_token_allowance: 2_000_000,
  wallet_balance_micros: 45_000,
  member_count: 3,
  checkpoints_used: 17,
  turns_used: 2_720,
  extractions_used: 17,
  embedding_tokens_used: 1_700,
};

const storeWith = (respond: Responder) => {
  const session = new FakeSession(respond);
  return { session, store: new PostgresQuotaStore(sourceOf(session)) };
};

describe('PostgresQuotaStore.quotaFor', () => {
  it('proves the connection enforces RLS before it opens the transaction', async () => {
    const { session, store } = storeWith(() => [ROW]);

    await store.quotaFor(WORKSPACE_ID, NOW);

    const posture = session.exchanges.findIndex((exchange) => exchange.sql === RLS_POSTURE_SQL);
    const begin = session.indexOf('BEGIN');

    expect(posture).toBeGreaterThanOrEqual(0);
    expect(begin).toBeGreaterThan(posture);
  });

  it('scopes the read to the workspace GUC before querying', async () => {
    const { session, store } = storeWith(() => [ROW]);

    await store.quotaFor(WORKSPACE_ID, NOW);

    const setting = session.exchanges.find((exchange) => exchange.sql.includes('set_config'));
    expect(setting?.params[0]).toBe(WORKSPACE_SETTING);
    expect(setting?.params[1]).toBe(WORKSPACE_ID);
    expect(session.indexOf('set_config')).toBeLessThan(session.indexOf('FROM workspace'));
  });

  it('reads plan, seats, allowance, members and usage in one round trip', async () => {
    const { session, store } = storeWith(() => [ROW]);

    await store.quotaFor(WORKSPACE_ID, NOW);

    const reads = session.exchanges.filter(
      (exchange) => exchange.sql.includes('SELECT') && exchange.sql.includes('FROM workspace'),
    );
    expect(reads).toHaveLength(1);

    const sql = reads[0]?.sql ?? '';
    expect(sql).toContain('w.turn_allowance');
    expect(sql).toContain('w.extraction_allowance');
    expect(sql).toContain('w.wallet_balance_micros');
    expect(sql).toContain('w.seats_purchased');
    expect(sql).toContain('team_member');
    expect(sql).toContain('workspace_usage_period');
    expect(sql).toContain('p.turns_used');
    expect(sql).toContain('p.extractions_used');
    expect(sql).not.toContain('count(DISTINCT u.created_at)');
  });

  it('reads the period row for the calendar month it was asked about', async () => {
    const { session, store } = storeWith(() => [ROW]);

    await store.quotaFor(WORKSPACE_ID, NOW);

    const read = session.exchanges.find((exchange) => exchange.sql.includes('FROM workspace'));
    expect(read?.params[1]).toBe('2026-08-01');
    expect(read?.sql).toContain('p.period_start = $2::date');
  });

  it('does not re-truncate the period in SQL, which would move with the session timezone', async () => {
    // date_trunc('month', $2::timestamptz) re-reads an instant that is already a UTC month
    // start in the session's TimeZone. On a non-UTC connection that resolves the first
    // hours of a month to the previous month's row, metering the workspace against a
    // period it is not in.
    const { session, store } = storeWith(() => [ROW]);

    await store.quotaFor(WORKSPACE_ID, new Date('2026-09-01T00:30:00.000Z'));

    const read = session.exchanges.find((exchange) => exchange.sql.includes('FROM workspace'));
    expect(read?.sql).not.toContain('date_trunc');
    expect(read?.params[1]).toBe('2026-09-01');
  });

  it('reads a workspace with no period row yet as zero, not as missing', async () => {
    const { store } = storeWith(() => [{ ...ROW, turns_used: 0, extractions_used: 0 }]);

    await expect(store.quotaFor(WORKSPACE_ID, NOW)).resolves.toMatchObject({
      extractionsUsed: 0,
    });
  });

  it('maps the row into a quota state the policy can decide on', async () => {
    const { store } = storeWith(() => [ROW]);

    await expect(store.quotaFor(WORKSPACE_ID, NOW)).resolves.toEqual({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 4,
      memberCount: 3,
      turnAllowance: 200_000,
      extractionAllowance: 1_250,
      embeddingTokenAllowance: 2_000_000,
      walletBalanceMicros: 45_000,
      turnsUsed: 2_720,
      extractionsUsed: 17,
      embeddingTokensUsed: 1_700,
      period: {
        start: new Date('2026-08-01T00:00:00.000Z'),
        end: new Date('2026-09-01T00:00:00.000Z'),
      },
    });
  });

  it('keeps a null allowance null rather than reading it as zero, which would refuse everyone', async () => {
    const { store } = storeWith(() => [{ ...ROW, extraction_allowance: null }]);

    const state = await store.quotaFor(WORKSPACE_ID, NOW);

    expect(state?.extractionAllowance).toBeNull();
  });

  it('returns null when row-level security hides the workspace', async () => {
    const { store } = storeWith(() => []);

    await expect(store.quotaFor(WORKSPACE_ID, NOW)).resolves.toBeNull();
  });

  it('refuses a workspace id that is not a UUID without opening a connection', async () => {
    const { session, store } = storeWith(() => [ROW]);

    await expect(store.quotaFor('not-a-uuid', NOW)).rejects.toBeInstanceOf(BillingError);
    expect(session.exchanges).toHaveLength(0);
  });

  it('refuses a usage count the database could not produce rather than guessing zero', async () => {
    const { store } = storeWith(() => [{ ...ROW, extractions_used: 'many' }]);

    await expect(store.quotaFor(WORKSPACE_ID, NOW)).rejects.toBeInstanceOf(BillingError);
  });

  it('discards the connection when the read fails, so no transaction is left open', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('FROM workspace')) {
        throw new Error('connection reset');
      }
      return [];
    });

    await expect(store.quotaFor(WORKSPACE_ID, NOW)).rejects.toThrow('connection reset');
    expect(session.discarded).toBe(1);
    expect(session.released).toBe(0);
  });
});
