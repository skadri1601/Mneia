import 'server-only';

import type { BillingSnapshot } from './billing-store.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PORTAL_STATUSES = new Set(['active', 'trialing', 'past_due', 'canceled']);

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
  if (snapshot.billingStatus === 'canceled') {
    return 'a canceled subscription cannot safely be restarted because its subscription id is not stored';
  }
  if (snapshot.plan !== 'solo' || snapshot.seatsPurchased !== null) {
    return 'this workspace already has an active subscription';
  }
  if (snapshot.billingStatus !== 'active') {
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
    ...(input.snapshot.billingCustomerRef === null
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
