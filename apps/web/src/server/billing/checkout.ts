import 'server-only';

import {
  type BillingSnapshot,
  type BillingStore,
  type SubscriptionAddress,
  subscriptionAddress,
} from './billing-store.js';
import { isSeatedPlan } from './limits.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PORTAL_STATUSES = new Set(['active', 'trialing', 'past_due']);

/**
 * The statuses in which moving the quantity means anything.
 *
 * The same three as the portal, and for the same reason: a cancelled subscription's item
 * must never be the target of a quantity change. `past_due` is included deliberately — a
 * team that removes a member while a payment is failing should still stop being billed for
 * that seat.
 */
const SYNCABLE_STATUSES = new Set(['active', 'trialing', 'past_due']);

/** Stripe rejects a quantity below one, and a Team workspace always has at least its lead. */
const MIN_SYNCABLE_SEATS = 1;

export class BillingControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingControlError';
  }
}

export interface BillingControlAccount {
  readonly workspaceId: string;
  readonly role: 'lead' | 'member';
}

interface BillingControlInput {
  readonly account: BillingControlAccount;
  readonly snapshot: BillingSnapshot;
}

interface BillingAttemptInput extends BillingControlInput {
  readonly attemptToken: string;
  readonly origin: string;
}

export interface CheckoutRequest {
  readonly workspaceId: string;
  readonly customerId?: string;
  readonly seats: number;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly idempotencyKey: string;
}

export interface PortalRequest {
  readonly customerId: string;
  readonly returnUrl: string;
  readonly idempotencyKey: string;
}

const assertAccountMatchesSnapshot = ({ account, snapshot }: BillingControlInput): void => {
  if (account.workspaceId !== snapshot.workspaceId) {
    throw new BillingControlError(
      'expected the authenticated workspace to match the billing snapshot; the snapshot was refused because billing must be derived from one workspace',
    );
  }
};

const assertLead = ({ account }: BillingControlInput): void => {
  if (account.role !== 'lead') {
    throw new BillingControlError('only a workspace lead can manage billing');
  }
};

const assertAttemptToken = (attemptToken: string): string => {
  if (!UUID_PATTERN.test(attemptToken)) {
    throw new BillingControlError(
      `expected a checkout attempt token UUID; received "${attemptToken.slice(0, 60)}"`,
    );
  }
  return attemptToken;
};

const billingUrl = (origin: string, suffix = ''): string => `${origin}/billing${suffix}`;

const checkoutFailure = ({ snapshot }: BillingControlInput): string | null => {
  if (snapshot.memberCount < 2) {
    return 'Team checkout needs at least two accepted members';
  }
  if (snapshot.plan !== 'solo' || snapshot.seatsPurchased !== null) {
    return 'this workspace already has an active subscription';
  }
  if (snapshot.billingStatus !== 'active' && snapshot.billingStatus !== 'canceled') {
    return `this workspace already has a ${snapshot.billingStatus} subscription state`;
  }
  return null;
};

export const canStartCheckout = (input: BillingControlInput): boolean => {
  if (input.account.workspaceId !== input.snapshot.workspaceId || input.account.role !== 'lead') {
    return false;
  }
  return checkoutFailure(input) === null;
};

export const canOpenPortal = (input: BillingControlInput): boolean =>
  input.account.workspaceId === input.snapshot.workspaceId &&
  input.account.role === 'lead' &&
  input.snapshot.billingCustomerRef !== null &&
  PORTAL_STATUSES.has(input.snapshot.billingStatus);

export const checkoutRequestFor = (input: BillingAttemptInput): CheckoutRequest => {
  assertAccountMatchesSnapshot(input);
  assertLead(input);
  const failure = checkoutFailure(input);
  if (failure !== null) throw new BillingControlError(`checkout refused: ${failure}`);

  const idempotencyKey = assertAttemptToken(input.attemptToken);
  return {
    workspaceId: input.snapshot.workspaceId,
    ...(input.snapshot.billingCustomerRef === null || input.snapshot.billingStatus === 'canceled'
      ? {}
      : { customerId: input.snapshot.billingCustomerRef }),
    seats: input.snapshot.memberCount,
    successUrl: billingUrl(input.origin, '?checkout=success'),
    cancelUrl: billingUrl(input.origin, '?checkout=canceled'),
    idempotencyKey,
  };
};

export const portalRequestFor = (input: BillingAttemptInput): PortalRequest => {
  assertAccountMatchesSnapshot(input);
  assertLead(input);
  if (input.snapshot.billingCustomerRef === null) {
    throw new BillingControlError('portal refused: this workspace has no Stripe customer');
  }
  if (!PORTAL_STATUSES.has(input.snapshot.billingStatus)) {
    throw new BillingControlError(
      `portal refused: expected an actionable billing status; received "${input.snapshot.billingStatus}"`,
    );
  }

  return {
    customerId: input.snapshot.billingCustomerRef,
    returnUrl: billingUrl(input.origin),
    idempotencyKey: assertAttemptToken(input.attemptToken),
  };
};

/**
 * Whether the Stripe subscription's quantity should be moved, and to what.
 *
 * Pure, like `checkoutRequestFor` and `portalRequestFor`: it decides, and the caller
 * executes against Stripe. `sync: false` is an ordinary outcome and carries a reason -
 * most calls are no-ops, because most membership changes do not move the seat count.
 */
export type SeatSyncDecision =
  | { readonly sync: true; readonly request: SeatSyncRequest; readonly direction: SeatDirection }
  | { readonly sync: false; readonly reason: string };

export type SeatDirection = 'increase' | 'decrease';

export interface SeatSyncRequest {
  readonly subscriptionId: string;
  readonly subscriptionItemId: string;
  readonly seats: number;
}

/**
 * Who asked, which decides whether the bill may go up.
 *
 * `purchase` is a workspace lead deliberately buying capacity. `membership` is a member
 * being invited, joining, or leaving - a consequence of someone else's action, which may
 * reduce the bill and must never raise it. **We do not charge a customer for a seat they
 * did not ask for**, and this is the line that enforces it.
 *
 * Nothing is lost by refusing: `admitOneMoreSeat` in seats.ts already refuses an invitation
 * that would exceed purchased seats, so the flow is refuse-then-purchase, and the purchase
 * is the explicit act that arrives here as `purchase`.
 */
export type SeatSyncIntent = 'purchase' | 'membership';

export interface SeatSyncInput {
  readonly snapshot: BillingSnapshot;
  readonly address: SubscriptionAddress | null;
  readonly desiredSeats: number;
  readonly intent: SeatSyncIntent;
}

export const seatSyncDecisionFor = (input: SeatSyncInput): SeatSyncDecision => {
  const { snapshot, address, desiredSeats, intent } = input;

  // Only Team is seat-priced. Pro is one seat by definition and Solo buys none, so there is
  // no quantity to move and reaching Stripe would be a round trip that cannot change
  // anything.
  if (!isSeatedPlan(snapshot.plan)) {
    return {
      sync: false,
      reason: `the ${snapshot.plan} plan is not seat-priced, so there is no subscription quantity to move`,
    };
  }

  if (!SYNCABLE_STATUSES.has(snapshot.billingStatus)) {
    return {
      sync: false,
      reason: `this workspace's subscription is "${snapshot.billingStatus}"; a quantity change is only meaningful while it is one of ${[...SYNCABLE_STATUSES].join(', ')}`,
    };
  }

  if (address === null) {
    return {
      sync: false,
      reason:
        'this workspace has no Stripe subscription recorded, so there is nothing to address. ' +
        'billing_subscription_ref and billing_subscription_item_ref (migration 0036) are written by the ' +
        'subscription webhook from the live Stripe object, so a workspace subscribed before that migration ' +
        'fills in on its next lifecycle event rather than needing a backfill.',
    };
  }

  if (!Number.isInteger(desiredSeats) || desiredSeats < MIN_SYNCABLE_SEATS) {
    throw new BillingControlError(
      `expected the desired seat count to be an integer of at least ${MIN_SYNCABLE_SEATS}; received ${String(desiredSeats)} — refusing to send a nonsense quantity to Stripe`,
    );
  }

  const purchased = snapshot.seatsPurchased ?? 0;
  if (desiredSeats === purchased) {
    return {
      sync: false,
      reason: `this workspace already has ${purchased} seat${purchased === 1 ? '' : 's'} purchased, which is what it needs`,
    };
  }

  const direction: SeatDirection = desiredSeats > purchased ? 'increase' : 'decrease';

  if (direction === 'increase' && intent !== 'purchase') {
    return {
      sync: false,
      reason:
        `raising the quantity from ${purchased} to ${desiredSeats} would increase this workspace's bill, and this change came from a membership event rather than a purchase. ` +
        'A seat is charged for only when a lead asks for it. Nothing is stuck: admitOneMoreSeat refuses the membership change that would need the seat, and the lead buys it from the billing page.',
    };
  }

  return {
    sync: true,
    direction,
    request: {
      subscriptionId: address.subscriptionId,
      subscriptionItemId: address.subscriptionItemId,
      seats: desiredSeats,
    },
  };
};

export interface SeatSyncOutcome {
  readonly synced: boolean;
  readonly reason: string;
  readonly seats: number | null;
}

/**
 * Pushes a workspace's seat count to its Stripe subscription.
 *
 * This is the thing that closes the leak. `StripeClient.updateSeats` has existed since
 * MNE-141 and was callable from nowhere, because the two identifiers it needs were not
 * stored; migration 0036 stores them and this reads them back.
 *
 * **Idempotent by construction.** `updateSeats` sends an absolute quantity, never a delta,
 * so applying the same decision twice leaves Stripe in the same place — which is what makes
 * a redelivered webhook or a double-submitted form harmless. It also means no processed-event
 * record is needed for this path, unlike anything that increments.
 *
 * Shaped to satisfy `SeatSubscriptionSync` in seats.ts. Structural rather than an explicit
 * `implements` because that interface is being edited in parallel; if the two drift, the
 * call site fails to compile, which is the loud outcome.
 */
export class StripeSeatSync {
  constructor(
    private readonly store: BillingStore,
    private readonly stripe: SeatQuantityClient,
  ) {}

  /**
   * A membership change — invited, joined, removed. May lower the bill, never raise it.
   */
  async syncSeats(input: {
    readonly workspaceId: string;
    readonly seats: number;
    readonly reason: 'member_invited' | 'member_joined' | 'member_removed';
  }): Promise<SeatSyncOutcome> {
    return this.apply(input.workspaceId, input.seats, 'membership');
  }

  /**
   * A lead deliberately buying or releasing capacity from the billing page. May raise it.
   */
  async purchaseSeats(input: {
    readonly workspaceId: string;
    readonly seats: number;
  }): Promise<SeatSyncOutcome> {
    return this.apply(input.workspaceId, input.seats, 'purchase');
  }

  private async apply(
    workspaceId: string,
    desiredSeats: number,
    intent: SeatSyncIntent,
  ): Promise<SeatSyncOutcome> {
    const snapshot = await this.store.snapshot(workspaceId);
    if (snapshot === null) {
      throw new BillingControlError(
        `expected workspace ${workspaceId} to have a billing snapshot before syncing seats; found none`,
      );
    }

    const ref = await this.store.subscriptionRef(workspaceId);
    const decision = seatSyncDecisionFor({
      snapshot,
      address: ref === null ? null : subscriptionAddress(ref),
      desiredSeats,
      intent,
    });

    if (!decision.sync) {
      return { synced: false, reason: decision.reason, seats: null };
    }

    // Proration is Stripe's `create_prorations`, set in updateSeats and deliberately left
    // alone in both directions. An increase bills the remainder of the period for the new
    // seat, which is what someone buying a seat mid-month expects. A decrease issues a
    // proration credit against the next invoice rather than a cash refund — the standard
    // SaaS posture, and already the repo's documented position: planSeatChange in seats.ts
    // reports a decrease as prorated "so a removed seat is credited", with a test asserting
    // it. Reversing that would be an agent quietly changing what customers are charged.
    await this.stripe.updateSeats(decision.request);

    return {
      synced: true,
      reason: `subscription quantity set to ${decision.request.seats} (${decision.direction})`,
      seats: decision.request.seats,
    };
  }
}

/** The one thing seat sync needs from the Stripe client, named so tests need no HTTP. */
export interface SeatQuantityClient {
  updateSeats(input: SeatSyncRequest): Promise<unknown>;
}

export const stripeHostedRedirectUrl = (url: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BillingControlError(
      `expected a Stripe-hosted redirect URL; received "${url.slice(0, 120)}"`,
    );
  }

  if (
    parsed.protocol !== 'https:' ||
    (parsed.hostname !== 'checkout.stripe.com' && parsed.hostname !== 'billing.stripe.com')
  ) {
    throw new BillingControlError(
      `expected a Stripe-hosted redirect URL; received "${url.slice(0, 120)}"`,
    );
  }
  return parsed.toString();
};
