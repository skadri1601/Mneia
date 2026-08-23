import 'server-only';

import type { BillingStatus, WorkspacePlan } from '@mneia/core';
import { isSeatedPlan } from './limits.js';
import { BillingError, SEAT_PRICE_USD_CENTS } from './stripe.js';

export const MIN_SEATS = 1;

export interface SeatRequirement {
  readonly members: number;
  readonly seats: number;
}

export const seatsRequiredFor = (members: number): SeatRequirement => {
  if (!Number.isInteger(members) || members < 0) {
    throw new BillingError(
      'invalid_payload',
      `expected the member count to be a non-negative integer; received ${String(members)}`,
    );
  }
  return { members, seats: Math.max(members, MIN_SEATS) };
};

export interface SeatChange {
  readonly from: number;
  readonly to: number;
  readonly direction: 'increase' | 'decrease' | 'unchanged';
  readonly prorated: boolean;
}

export const planSeatChange = (current: number, required: number): SeatChange => {
  if (!Number.isInteger(required) || required < MIN_SEATS) {
    throw new BillingError(
      'invalid_payload',
      `expected the required seat count to be an integer of at least ${MIN_SEATS}; received ${String(required)}`,
    );
  }

  if (required === current) {
    return { from: current, to: current, direction: 'unchanged', prorated: false };
  }

  return {
    from: current,
    to: required,
    direction: required > current ? 'increase' : 'decrease',
    prorated: true,
  };
};

export interface BillingState {
  readonly plan: WorkspacePlan;
  readonly billingStatus: BillingStatus;
  readonly seatsPurchased: number | null;
  readonly billingCustomerRef: string | null;
}

export const STRIPE_STATUS_TO_BILLING: Readonly<Record<string, BillingStatus>> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'past_due',
  incomplete_expired: 'canceled',
  canceled: 'canceled',
  paused: 'canceled',
};

export const billingStatusFor = (stripeStatus: string): BillingStatus => {
  const mapped = STRIPE_STATUS_TO_BILLING[stripeStatus];
  if (mapped === undefined) {
    throw new BillingError(
      'invalid_payload',
      `expected a known Stripe subscription status; received "${stripeStatus}". ` +
        `Known: ${Object.keys(STRIPE_STATUS_TO_BILLING).join(', ')}. An unmapped status is refused rather than guessed, ` +
        'because guessing it wrong either bills a cancelled workspace or gives a lapsed one free capacity.',
    );
  }
  return mapped;
};

export const hasTeamEntitlement = (state: BillingState): boolean =>
  state.plan === 'team' &&
  state.seatsPurchased !== null &&
  (state.billingStatus === 'active' ||
    state.billingStatus === 'trialing' ||
    state.billingStatus === 'past_due');

const stripeStatusHasTeamEntitlement = (status: string): boolean =>
  status === 'active' || status === 'trialing' || status === 'past_due';

export interface UpgradeRequest {
  readonly current: BillingState;
  readonly subscriptionStatus: string;
  readonly seats: number;
  readonly customerRef: string;
}

const NOT_GOVERNED_BY_TEAM_SUBSCRIPTION: readonly WorkspacePlan[] = ['pro', 'enterprise'];

const planAfterSubscription = (current: WorkspacePlan, teamEntitled: boolean): WorkspacePlan => {
  if (teamEntitled) {
    return current === 'enterprise' ? 'enterprise' : 'team';
  }
  return NOT_GOVERNED_BY_TEAM_SUBSCRIPTION.includes(current) ? current : 'solo';
};

export const stateAfterSubscription = (request: UpgradeRequest): BillingState => {
  const status = billingStatusFor(request.subscriptionStatus);
  const teamEntitled = stripeStatusHasTeamEntitlement(request.subscriptionStatus);

  return {
    plan: planAfterSubscription(request.current.plan, teamEntitled),
    billingStatus: status,
    seatsPurchased: teamEntitled ? request.seats : null,
    billingCustomerRef: request.customerRef,
  };
};

/**
 * What a workspace's seat position is at the moment someone is about to be added.
 *
 * `pendingInvitations` counts only *live* invitations — issued, not accepted, not revoked,
 * not expired. They are counted against seats because each one is a promise of a seat
 * already made to a named person. Leaving them out of the arithmetic lets a lead issue ten
 * invitations against one spare seat and discover the overrun when the second is accepted,
 * which is precisely the failure this admission check exists to prevent.
 */
export interface SeatPosition {
  readonly plan: WorkspacePlan;
  readonly billingStatus: BillingStatus;
  readonly seatsPurchased: number | null;
  readonly memberCount: number;
  readonly pendingInvitations: number;
}

/** Seats already spoken for: accepted members plus invitations still capable of being accepted. */
export const seatsCommitted = (position: SeatPosition): number =>
  position.memberCount + position.pendingInvitations;

/** The quantity a seat-priced subscription should carry for this position. */
export const desiredSeatQuantity = (position: SeatPosition): number =>
  Math.max(seatsCommitted(position), MIN_SEATS);

export type SeatAdmission =
  | { readonly admitted: true; readonly seatsSpare: number | null }
  | {
      readonly admitted: false;
      readonly code: 'seats_exceeded';
      readonly seatsPurchased: number;
      readonly seatsNeeded: number;
      readonly additionalSeats: number;
      readonly additionalMonthlyUsdCents: number;
      readonly message: string;
    };

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const countOf = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Whether one more person may be admitted to this workspace, and what it costs if not.
 *
 * This is the counterpart of the `seats_exceeded` refusal in `quota.ts`. That refusal is
 * workspace-wide: once accepted members exceed purchased seats, **every** member is refused
 * a checkpoint, not just the newest one. Discovering that at checkpoint time means one
 * accepted invitation silently disabled the whole team. So the decision is taken here, at
 * the moment the seat is committed, where it can still be declined and where the person
 * taking it is the lead who can pay for it.
 *
 * Only Team is seat-priced (`isSeatedPlan`). Solo and Pro are deliberately admitted without
 * limit: `checkout.ts` requires at least two accepted members before Team checkout can even
 * start, so gating growth on a free workspace would close the on-ramp to the paid plan.
 */
export const admitOneMoreSeat = (position: SeatPosition): SeatAdmission => {
  if (!isSeatedPlan(position.plan)) {
    return { admitted: true, seatsSpare: null };
  }

  const seatsPurchased = Math.max(position.seatsPurchased ?? 0, 0);
  const committed = seatsCommitted(position);
  const seatsNeeded = committed + 1;

  if (seatsNeeded <= seatsPurchased) {
    return { admitted: true, seatsSpare: seatsPurchased - seatsNeeded };
  }

  const additionalSeats = seatsNeeded - seatsPurchased;
  const additionalMonthlyUsdCents = additionalSeats * SEAT_PRICE_USD_CENTS;

  return {
    admitted: false,
    code: 'seats_exceeded',
    seatsPurchased,
    seatsNeeded,
    additionalSeats,
    additionalMonthlyUsdCents,
    message:
      `expected this workspace to have a spare seat; it has ${countOf(seatsPurchased, 'purchased seat')} and ` +
      `${countOf(committed, 'seat')} already committed (${countOf(position.memberCount, 'member')}, ` +
      `${countOf(position.pendingInvitations, 'invitation')} waiting), so one more needs ` +
      `${countOf(seatsNeeded, 'seat')} — ${countOf(additionalSeats, 'seat')} more at ` +
      `${usd(SEAT_PRICE_USD_CENTS)} per seat per month, ${usd(additionalMonthlyUsdCents)} a month extra. ` +
      'Add the seat from the billing page first. Issuing this invitation now would stop every member ' +
      'of the workspace from checkpointing the moment it is accepted, not just the person joining.',
  };
};

/**
 * The one thing seat management needs from the Stripe layer and does not own.
 *
 * `apps/web/src/server/billing/stripe.ts` already has `StripeClient.updateSeats`, but it is
 * called from nowhere and needs a subscription id and a subscription item id that no column
 * on `workspace` currently stores — only `billing_customer_ref` is persisted. Until that
 * exists, membership is written and tested against this interface rather than against Stripe,
 * so wiring a real implementation is a constructor argument rather than a rewrite.
 */
export interface SeatSubscriptionSync {
  syncSeats(input: {
    readonly workspaceId: string;
    readonly seats: number;
    readonly reason: 'member_invited' | 'member_joined' | 'member_removed';
  }): Promise<void>;
}
