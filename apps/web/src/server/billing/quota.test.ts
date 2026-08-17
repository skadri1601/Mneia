import { describe, expect, it, vi } from 'vitest';
import type { QuotaState } from './quota.js';

vi.mock('server-only', () => ({}));

const { checkpointQuota, monthPeriod } = await import('./quota.js');

const PERIOD = monthPeriod(new Date('2026-08-16T12:00:00.000Z'));

const state = (overrides: Partial<QuotaState> = {}): QuotaState => ({
  plan: 'solo',
  billingStatus: 'active',
  seatsPurchased: null,
  memberCount: 1,
  checkpointAllowance: null,
  checkpointsUsed: 0,
  period: PERIOD,
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
  it('leaves a null allowance unmetered, because every workspace has one today', () => {
    expect(checkpointQuota(state({ checkpointAllowance: null, checkpointsUsed: 9_999 }))).toEqual({
      allowed: true,
    });
  });

  it('refuses at the allowance rather than one past it', () => {
    expect(checkpointQuota(state({ checkpointAllowance: 10, checkpointsUsed: 10 }))).toMatchObject({
      allowed: false,
      code: 'allowance_exhausted',
    });
    expect(checkpointQuota(state({ checkpointAllowance: 10, checkpointsUsed: 9 }))).toEqual({
      allowed: true,
    });
  });

  it('names usage, allowance and the reset boundary, so the refusal says what to do', () => {
    const decision = checkpointQuota(state({ checkpointAllowance: 10, checkpointsUsed: 10 }));

    expect(decision.allowed).toBe(false);
    if (decision.allowed) {
      throw new Error('expected the decision to be a refusal');
    }
    expect(decision.message).toContain('10 of its 10');
    expect(decision.message).toContain('2026-09-01T00:00:00.000Z');
  });

  it('enforces a configured allowance on solo without mentioning checkout', () => {
    const decision = checkpointQuota(
      state({ plan: 'solo', checkpointAllowance: 3, checkpointsUsed: 3 }),
    );

    expect(decision).toMatchObject({ allowed: false, code: 'allowance_exhausted' });
    if (decision.allowed) {
      throw new Error('expected the decision to be a refusal');
    }
    expect(decision.message).not.toContain('seat');
  });

  it('keeps a past-due Team workspace working, because dunning is not cancellation', () => {
    expect(
      checkpointQuota(
        state({ plan: 'team', billingStatus: 'past_due', seatsPurchased: 3, memberCount: 3 }),
      ),
    ).toEqual({ allowed: true });
  });

  it.each(['active', 'trialing'] as const)('allows a %s Team workspace', (billingStatus) => {
    expect(
      checkpointQuota(state({ plan: 'team', billingStatus, seatsPurchased: 2, memberCount: 2 })),
    ).toEqual({ allowed: true });
  });

  it('refuses a Team workspace whose subscription is no longer entitled', () => {
    expect(
      checkpointQuota(
        state({ plan: 'team', billingStatus: 'canceled', seatsPurchased: 3, memberCount: 3 }),
      ),
    ).toMatchObject({ allowed: false, code: 'subscription_inactive' });
  });

  it('refuses a Team workspace with fewer seats than members', () => {
    const decision = checkpointQuota(
      state({ plan: 'team', billingStatus: 'active', seatsPurchased: 2, memberCount: 5 }),
    );

    expect(decision).toMatchObject({ allowed: false, code: 'seats_exceeded' });
    if (decision.allowed) {
      throw new Error('expected the decision to be a refusal');
    }
    expect(decision.message).toContain('5 members');
    expect(decision.message).toContain('2 purchased seats');
  });

  it('checks entitlement before the allowance, so the actionable refusal wins', () => {
    expect(
      checkpointQuota(
        state({
          plan: 'team',
          billingStatus: 'canceled',
          seatsPurchased: 1,
          memberCount: 4,
          checkpointAllowance: 1,
          checkpointsUsed: 99,
        }),
      ),
    ).toMatchObject({ code: 'subscription_inactive' });
  });

  it('holds an enterprise workspace to its explicit allowance, and to nothing else', () => {
    expect(
      checkpointQuota(
        state({
          plan: 'enterprise',
          billingStatus: 'active',
          seatsPurchased: null,
          memberCount: 400,
          checkpointAllowance: 50_000,
          checkpointsUsed: 12,
        }),
      ),
    ).toEqual({ allowed: true });

    expect(
      checkpointQuota(
        state({
          plan: 'enterprise',
          billingStatus: 'active',
          memberCount: 400,
          checkpointAllowance: 50_000,
          checkpointsUsed: 50_000,
        }),
      ),
    ).toMatchObject({ allowed: false, code: 'allowance_exhausted' });
  });
});
