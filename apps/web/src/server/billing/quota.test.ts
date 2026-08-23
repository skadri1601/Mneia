import { describe, expect, it, vi } from 'vitest';
import type { QuotaRequest, QuotaState } from './quota.js';

vi.mock('server-only', () => ({}));

const { checkpointQuota, monthPeriod } = await import('./quota.js');
const { planLimits } = await import('./limits.js');

const PERIOD = monthPeriod(new Date('2026-08-16T12:00:00.000Z'));

const state = (overrides: Partial<QuotaState> = {}): QuotaState => ({
  plan: 'solo',
  billingStatus: 'active',
  seatsPurchased: null,
  memberCount: 1,
  turnAllowance: null,
  extractionAllowance: null,
  embeddingTokenAllowance: null,
  turnsUsed: 0,
  extractionsUsed: 0,
  embeddingTokensUsed: 0,
  walletBalanceMicros: 0,
  period: PERIOD,
  ...overrides,
});

/** A modest checkpoint: a few hundred turns, costing about half a cent. */
const request = (overrides: Partial<QuotaRequest> = {}): QuotaRequest => ({
  turns: 160,
  estimatedCostMicros: 6_200,
  ...overrides,
});

describe('monthPeriod', () => {
  it('spans the calendar month in UTC, so the boundary does not move with the server', () => {
    const period = monthPeriod(new Date('2026-08-31T23:59:59.999Z'));

    expect(period.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(period.end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls into the next year from December', () => {
    expect(monthPeriod(new Date('2026-12-04T00:00:00.000Z')).end.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('checkpointQuota', () => {
  it('allows a fresh workspace from its allowance', () => {
    expect(checkpointQuota(state(), request())).toEqual({ allowed: true, source: 'allowance' });
  });

  describe('the subscription gate covers every paid plan', () => {
    // Gating on Team alone let a cancelled Pro workspace keep its full allowance, which is
    // the whole reason Pro could not be sold until this was fixed.
    it.each(['pro', 'team'] as const)('refuses %s when the subscription is canceled', (plan) => {
      const decision = checkpointQuota(
        state({ plan, billingStatus: 'canceled', seatsPurchased: 5 }),
        request(),
      );

      expect(decision).toMatchObject({ allowed: false, code: 'subscription_inactive' });
    });

    it.each(['active', 'trialing', 'past_due'] as const)('lets %s through', (billingStatus) => {
      // past_due is deliberately entitled: a failed card should prompt a fix, not silently
      // stop a team from capturing work they will be billed for anyway.
      expect(checkpointQuota(state({ plan: 'pro', billingStatus }), request()).allowed).toBe(true);
    });

    it.each(['solo', 'enterprise'] as const)('does not gate %s on a subscription', (plan) => {
      // Free has nothing to lapse, and enterprise is the internal vehicle - gating it would
      // mean our own dogfooding stops when a billing row is untidy.
      expect(checkpointQuota(state({ plan, billingStatus: 'canceled' }), request()).allowed).toBe(
        true,
      );
    });
  });

  describe('seats', () => {
    it('refuses a team with more members than purchased seats', () => {
      const decision = checkpointQuota(
        state({ plan: 'team', seatsPurchased: 2, memberCount: 3 }),
        request(),
      );

      expect(decision).toMatchObject({ allowed: false, code: 'seats_exceeded' });
    });

    it('does not apply the seat check to a single-seat paid plan', () => {
      // Pro is one seat by definition, so it never purchases seats and must not be
      // measured against a count it does not have.
      expect(
        checkpointQuota(state({ plan: 'pro', seatsPurchased: null, memberCount: 1 }), request())
          .allowed,
      ).toBe(true);
    });
  });

  describe('the dials', () => {
    it('refuses when this request would push turns past the allowance', () => {
      // Checked against what the request consumes, not just what is already spent, so one
      // oversized upload cannot step over the ceiling in a single move.
      const limits = planLimits('solo');
      const decision = checkpointQuota(
        state({ turnsUsed: (limits.turns ?? 0) - 10 }),
        request({ turns: 100 }),
      );

      expect(decision).toMatchObject({ allowed: false, dial: 'turns' });
    });

    it('refuses when the extraction allowance is spent, even with turns to spare', () => {
      const limits = planLimits('solo');
      const decision = checkpointQuota(
        state({ extractionsUsed: limits.extractions ?? 0 }),
        request({ turns: 1 }),
      );

      expect(decision).toMatchObject({ allowed: false, dial: 'extractions' });
    });

    it('meters enterprise against nothing at all', () => {
      expect(
        checkpointQuota(
          state({ plan: 'enterprise', turnsUsed: 10_000_000, extractionsUsed: 10_000_000 }),
          request(),
        ),
      ).toEqual({ allowed: true, source: 'allowance' });
    });

    it('lets a per-workspace override beat the plan default', () => {
      // This is the grant path: a design partner or promo gets headroom without inventing
      // a plan for them.
      const limits = planLimits('solo');
      const used = (limits.extractions ?? 0) + 5;

      expect(
        checkpointQuota(
          state({ extractionsUsed: used, extractionAllowance: used + 100 }),
          request(),
        ).allowed,
      ).toBe(true);
    });

    it('pools a team allowance across purchased seats', () => {
      // Per seat and pooled, so one heavy user draws on a quiet colleague's share rather
      // than being refused while the team has headroom.
      const perSeat = planLimits('team').extractions ?? 0;

      const decision = checkpointQuota(
        state({
          plan: 'team',
          seatsPurchased: 4,
          memberCount: 4,
          extractionsUsed: perSeat * 3,
        }),
        request(),
      );

      expect(decision.allowed).toBe(true);
    });
  });

  describe('the wallet', () => {
    const exhausted = (overrides: Partial<QuotaState> = {}): QuotaState =>
      state({ extractionsUsed: planLimits('solo').extractions ?? 0, ...overrides });

    it('draws on prepaid balance once the allowance is gone', () => {
      // BUSINESS.md has always said allowance then overage. Work does not stop while there
      // is balance to spend.
      const decision = checkpointQuota(exhausted({ walletBalanceMicros: 50_000 }), request());

      expect(decision).toEqual({ allowed: true, source: 'wallet', debitMicros: 6_200 });
    });

    it('refuses when the balance cannot cover this checkpoint, and says so', () => {
      const decision = checkpointQuota(exhausted({ walletBalanceMicros: 100 }), request());

      expect(decision).toMatchObject({ allowed: false, code: 'wallet_empty' });
      if (!decision.allowed) {
        expect(decision.message).toContain('$0.00');
      }
    });

    it('names the allowance, not the wallet, when there is no balance at all', () => {
      // A customer who has never topped up should be told to add a balance, not that an
      // empty one fell short.
      const decision = checkpointQuota(exhausted(), request());

      expect(decision).toMatchObject({ allowed: false, code: 'allowance_exhausted' });
    });
  });
});
