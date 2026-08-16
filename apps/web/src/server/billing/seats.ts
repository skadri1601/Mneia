import 'server-only';

import type { BillingStatus, WorkspacePlan } from '@mneia/core';
import { BillingError } from './stripe.js';

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

export const stateAfterSubscription = (request: UpgradeRequest): BillingState => {
  const status = billingStatusFor(request.subscriptionStatus);
  const teamEntitled = stripeStatusHasTeamEntitlement(request.subscriptionStatus);

  return {
    plan:
      request.current.plan === 'enterprise' ? 'enterprise' : teamEntitled ? 'team' : 'solo',
    billingStatus: status,
    seatsPurchased: teamEntitled ? request.seats : null,
    billingCustomerRef: request.customerRef,
  };
};
