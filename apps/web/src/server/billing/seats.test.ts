import { describe, expect, it, vi } from 'vitest';
import type { SeatPosition } from './seats.js';

vi.mock('server-only', () => ({}));

const { admitOneMoreSeat, desiredSeatQuantity, seatsCommitted } = await import('./seats.js');
const { SEAT_PRICE_USD_CENTS } = await import('./stripe.js');

const position = (overrides: Partial<SeatPosition> = {}): SeatPosition => ({
  plan: 'team',
  billingStatus: 'active',
  seatsPurchased: 5,
  memberCount: 5,
  pendingInvitations: 0,
  ...overrides,
});

describe('seatsCommitted', () => {
  it('counts a live invitation as a seat already promised', () => {
    expect(seatsCommitted(position({ memberCount: 4, pendingInvitations: 2 }))).toBe(6);
  });
});

describe('desiredSeatQuantity', () => {
  it('never falls below one, so an empty workspace cannot ask Stripe for zero seats', () => {
    expect(desiredSeatQuantity(position({ memberCount: 0, pendingInvitations: 0 }))).toBe(1);
  });

  it('is what the subscription quantity should be for the committed seats', () => {
    expect(desiredSeatQuantity(position({ memberCount: 4, pendingInvitations: 3 }))).toBe(7);
  });
});

describe('admitOneMoreSeat', () => {
  it('admits when a purchased seat is spare', () => {
    expect(admitOneMoreSeat(position({ seatsPurchased: 8, memberCount: 5 }))).toEqual({
      admitted: true,
      seatsSpare: 2,
    });
  });

  it('refuses the sixth member on five seats, rather than blocking the whole team later', () => {
    const admission = admitOneMoreSeat(position({ seatsPurchased: 5, memberCount: 5 }));

    expect(admission.admitted).toBe(false);
    if (admission.admitted) return;
    expect(admission.code).toBe('seats_exceeded');
    expect(admission.seatsNeeded).toBe(6);
    expect(admission.additionalSeats).toBe(1);
    expect(admission.additionalMonthlyUsdCents).toBe(SEAT_PRICE_USD_CENTS);
  });

  it('names the seats needed, the cost, and the billing page in the message', () => {
    const admission = admitOneMoreSeat(position({ seatsPurchased: 5, memberCount: 5 }));

    expect(admission.admitted).toBe(false);
    if (admission.admitted) return;
    expect(admission.message).toContain('5 purchased seats');
    expect(admission.message).toContain('6 seats');
    expect(admission.message).toContain('$25.00');
    expect(admission.message).toContain('billing page');
  });

  it('counts invitations already waiting, so ten invites cannot be issued against one seat', () => {
    const admission = admitOneMoreSeat(
      position({ seatsPurchased: 6, memberCount: 5, pendingInvitations: 1 }),
    );

    expect(admission.admitted).toBe(false);
    if (admission.admitted) return;
    expect(admission.seatsNeeded).toBe(7);
    expect(admission.additionalSeats).toBe(1);
  });

  it('prices several missing seats together', () => {
    const admission = admitOneMoreSeat(
      position({ seatsPurchased: 2, memberCount: 5, pendingInvitations: 1 }),
    );

    expect(admission.admitted).toBe(false);
    if (admission.admitted) return;
    expect(admission.additionalSeats).toBe(5);
    expect(admission.additionalMonthlyUsdCents).toBe(5 * SEAT_PRICE_USD_CENTS);
  });

  it('treats a team plan with no purchased seats as zero rather than unlimited', () => {
    const admission = admitOneMoreSeat(position({ seatsPurchased: null, memberCount: 1 }));

    expect(admission.admitted).toBe(false);
    if (admission.admitted) return;
    expect(admission.seatsPurchased).toBe(0);
    expect(admission.seatsNeeded).toBe(2);
  });

  it.each(['solo', 'pro', 'enterprise'] as const)(
    'admits without limit on %s, which is not seat-priced',
    (plan) => {
      // checkout.ts refuses Team checkout below two accepted members, so gating growth on a
      // free workspace would close the only route onto the paid plan.
      expect(admitOneMoreSeat(position({ plan, seatsPurchased: null, memberCount: 40 }))).toEqual({
        admitted: true,
        seatsSpare: null,
      });
    },
  );
});
