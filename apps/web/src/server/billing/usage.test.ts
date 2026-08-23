import { describe, expect, it, vi } from 'vitest';
import type { QuotaState } from './quota.js';

vi.mock('server-only', () => ({}));

const { monthPeriod } = await import('./quota.js');
const { planLimits } = await import('./limits.js');
const { clientVisibleUsage, USAGE_WARN_PERCENT, usageReport } = await import('./usage.js');

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

describe('usageReport', () => {
  it('carries the plan, the period and the checkpoint count through unchanged', () => {
    const report = usageReport(state({ plan: 'pro' }), 17);

    expect(report.plan).toBe('pro');
    expect(report.periodStart).toBe('2026-08-01T00:00:00.000Z');
    expect(report.periodEnd).toBe('2026-09-01T00:00:00.000Z');
    expect(report.checkpoints).toBe(17);
  });

  describe('an uncapped plan has no percentage to show', () => {
    it('reports null allowances, null fractions and a null percentage', () => {
      const report = usageReport(
        state({ plan: 'enterprise', turnsUsed: 5_000_000, extractionsUsed: 90_000 }),
        400,
      );

      expect(report.turns).toEqual({ used: 5_000_000, allowance: null, fraction: null });
      expect(report.extractions).toEqual({ used: 90_000, allowance: null, fraction: null });
      expect(report.percentUsed).toBeNull();
    });

    it('never warns, because there is nothing to run out of', () => {
      expect(usageReport(state({ plan: 'enterprise', turnsUsed: 5_000_000 }), 400).warn).toBe(
        false,
      );
    });
  });

  describe('a zero allowance', () => {
    // Dividing by it would give Infinity for any use and NaN for none, and both render as
    // a broken bar rather than as "this workspace may not checkpoint".
    it('is fully spent with nothing used, rather than NaN', () => {
      const report = usageReport(state({ plan: 'pro', turnAllowance: 0 }), 0);

      expect(report.turns.fraction).toBe(1);
      expect(Number.isFinite(report.turns.fraction)).toBe(true);
      expect(report.percentUsed).toBe(100);
    });

    it('is fully spent with something used, rather than Infinity', () => {
      const report = usageReport(state({ plan: 'pro', turnAllowance: 0, turnsUsed: 12 }), 1);

      expect(report.turns.fraction).toBe(1);
      expect(Number.isFinite(report.turns.fraction)).toBe(true);
      expect(report.percentUsed).toBe(100);
    });
  });

  describe('the bar tracks whichever dial binds', () => {
    it('follows turns when turns are the more consumed dial', () => {
      const report = usageReport(
        state({ plan: 'pro', turnAllowance: 1_000, turnsUsed: 700, extractionAllowance: 1_000 }),
        7,
      );

      expect(report.turns.fraction).toBeCloseTo(0.7, 10);
      expect(report.extractions.fraction).toBe(0);
      expect(report.percentUsed).toBe(70);
    });

    it('follows extractions when extractions are the more consumed dial', () => {
      const report = usageReport(
        state({
          plan: 'pro',
          turnAllowance: 1_000,
          turnsUsed: 100,
          extractionAllowance: 1_000,
          extractionsUsed: 640,
        }),
        640,
      );

      expect(report.percentUsed).toBe(64);
    });

    it('takes the capped dial when only one of the two is capped', () => {
      const report = usageReport(
        state({ plan: 'enterprise', extractionAllowance: 200, extractionsUsed: 50 }),
        50,
      );

      expect(report.turns.allowance).toBeNull();
      expect(report.percentUsed).toBe(25);
    });
  });

  describe('the warn boundary', () => {
    const atExtractionPercent = (percent: number): ReturnType<typeof usageReport> =>
      usageReport(
        state({ plan: 'pro', extractionAllowance: 100, extractionsUsed: percent }),
        percent,
      );

    it('does not warn at 79%', () => {
      const report = atExtractionPercent(79);

      expect(report.percentUsed).toBe(79);
      expect(report.warn).toBe(false);
    });

    it('warns at exactly 80%', () => {
      const report = atExtractionPercent(USAGE_WARN_PERCENT);

      expect(report.percentUsed).toBe(USAGE_WARN_PERCENT);
      expect(report.warn).toBe(true);
    });

    it('warns at 81%', () => {
      expect(atExtractionPercent(81).warn).toBe(true);
    });

    // 79.6% rounding up to 80 would fire the warning a checkpoint early, and 99.6% rounding
    // to 100 would tell a workspace it is out while it can still write.
    it('rounds down, so a fraction below the boundary does not trip it', () => {
      const report = usageReport(
        state({ plan: 'pro', extractionAllowance: 1_000, extractionsUsed: 796 }),
        796,
      );

      expect(report.percentUsed).toBe(79);
      expect(report.warn).toBe(false);
    });

    it('rounds down at the top, so 99.6% does not read as exhausted', () => {
      expect(
        usageReport(state({ plan: 'pro', extractionAllowance: 1_000, extractionsUsed: 996 }), 996)
          .percentUsed,
      ).toBe(99);
    });
  });

  describe('use beyond the allowance', () => {
    it('clamps the percentage at 100 rather than reporting 150', () => {
      const report = usageReport(
        state({ plan: 'pro', extractionAllowance: 100, extractionsUsed: 150 }),
        150,
      );

      expect(report.percentUsed).toBe(100);
      expect(report.warn).toBe(true);
    });

    it('leaves the dial fraction unclamped, so the arithmetic behind the bar stays visible', () => {
      const report = usageReport(
        state({ plan: 'pro', extractionAllowance: 100, extractionsUsed: 150 }),
        150,
      );

      expect(report.extractions.fraction).toBe(1.5);
    });
  });

  describe('the embedding dial is recorded, never shown', () => {
    it('does not bind the percentage even when it is the most consumed dial', () => {
      const limits = planLimits('solo');
      const report = usageReport(
        state({
          turnsUsed: 6_400,
          extractionsUsed: 40,
          embeddingTokensUsed: limits.embeddingTokens ?? 0,
        }),
        40,
      );

      expect(report.embeddingTokens.fraction).toBe(1);
      expect(report.percentUsed).toBe(10);
      expect(report.warn).toBe(false);
    });

    it('is still reported, so the cost of a period is computable', () => {
      const report = usageReport(state({ embeddingTokensUsed: 64_000 }), 4);

      expect(report.embeddingTokens).toEqual({
        used: 64_000,
        allowance: planLimits('solo').embeddingTokens,
        fraction: 0.1,
      });
    });
  });

  describe('team allowances are pooled across purchased seats', () => {
    // The meter has to agree with what refuses. quota.ts multiplies a seated plan's
    // per-seat allowance by seats_purchased, so a report that used the per-seat figure
    // would show a three-seat team at 100% while checkpointing kept working.
    it('multiplies the plan default by the seat count', () => {
      const perSeat = planLimits('team').extractions ?? 0;
      const report = usageReport(
        state({
          plan: 'team',
          seatsPurchased: 3,
          memberCount: 3,
          extractionsUsed: perSeat,
        }),
        perSeat,
      );

      expect(report.extractions.allowance).toBe(perSeat * 3);
      expect(report.percentUsed).toBe(33);
    });

    it('multiplies a per-workspace override by the seat count too', () => {
      const report = usageReport(
        state({
          plan: 'team',
          seatsPurchased: 4,
          memberCount: 4,
          extractionAllowance: 500,
          extractionsUsed: 1_000,
        }),
        1_000,
      );

      expect(report.extractions.allowance).toBe(2_000);
      expect(report.percentUsed).toBe(50);
    });

    it('leaves a single-seat plan alone', () => {
      const report = usageReport(
        state({ plan: 'pro', seatsPurchased: 9, extractionsUsed: 170 }),
        170,
      );

      expect(report.extractions.allowance).toBe(planLimits('pro').extractions);
      expect(report.percentUsed).toBe(10);
    });
  });
});

describe('clientVisibleUsage', () => {
  // The embedding dial is recorded so cost is computable and is never rendered to a
  // customer. A field that reaches a client is a field a client eventually displays, so it
  // is dropped at the wire rather than left to each surface to remember not to show.
  it('drops the embedding dial', () => {
    const wire = clientVisibleUsage(usageReport(state({ embeddingTokensUsed: 64_000 }), 4));

    expect(Object.hasOwn(wire, 'embeddingTokens')).toBe(false);
  });

  it('keeps every other field the meter reports', () => {
    const report = usageReport(
      state({ plan: 'pro', extractionAllowance: 100, extractionsUsed: 90 }),
      90,
    );

    expect(clientVisibleUsage(report)).toEqual({
      plan: 'pro',
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      turns: report.turns,
      extractions: report.extractions,
      checkpoints: 90,
      percentUsed: 90,
      warn: true,
    });
  });
});
