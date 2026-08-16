import { describe, expect, it, vi } from 'vitest';
import type { BillingSnapshot } from './billing-store.js';
import {
  BillingControlError,
  checkoutRequestFor,
  portalRequestFor,
  stripeHostedRedirectUrl,
} from './checkout.js';

vi.mock('server-only', () => ({}));

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ATTEMPT = '22222222-2222-4222-8222-222222222222';

const snapshot = (overrides: Partial<BillingSnapshot> = {}): BillingSnapshot => ({
  workspaceId: WORKSPACE_ID,
  plan: 'solo',
  billingStatus: 'active',
  seatsPurchased: null,
  billingCustomerRef: null,
  memberCount: 3,
  ...overrides,
});

const account = (role: 'lead' | 'member' = 'lead') => ({
  workspaceId: WORKSPACE_ID,
  role,
});

describe('checkoutRequestFor', () => {
  it('uses the accepted member count, retained customer, and render attempt for a lead checkout', () => {
    expect(
      checkoutRequestFor({
        account: account(),
        snapshot: snapshot({ billingCustomerRef: 'cus_existing' }),
        attemptToken: ATTEMPT,
        origin: 'https://app.mneia.dev',
      }),
    ).toEqual({
      workspaceId: WORKSPACE_ID,
      customerId: 'cus_existing',
      seats: 3,
      successUrl: 'https://app.mneia.dev/billing?checkout=success',
      cancelUrl: 'https://app.mneia.dev/billing?checkout=canceled',
      idempotencyKey: ATTEMPT,
    });
  });

  it('refuses a member before a checkout session can be made', () => {
    expect(() =>
      checkoutRequestFor({
        account: account('member'),
        snapshot: snapshot(),
        attemptToken: ATTEMPT,
        origin: 'https://app.mneia.dev',
      }),
    ).toThrow(BillingControlError);
  });

  it('refuses a workspace that already has an active subscription', () => {
    expect(() =>
      checkoutRequestFor({
        account: account(),
        snapshot: snapshot({ plan: 'team', seatsPurchased: 3, billingCustomerRef: 'cus_active' }),
        attemptToken: ATTEMPT,
        origin: 'https://app.mneia.dev',
      }),
    ).toThrow(/active subscription/);
  });

  it('refuses a cancelled workspace because its safe resubscription id is not stored', () => {
    expect(() =>
      checkoutRequestFor({
        account: account(),
        snapshot: snapshot({ billingStatus: 'canceled', billingCustomerRef: 'cus_cancelled' }),
        attemptToken: ATTEMPT,
        origin: 'https://app.mneia.dev',
      }),
    ).toThrow(/canceled/);
  });

  it('refuses anything other than a UUID render attempt token', () => {
    expect(() =>
      checkoutRequestFor({
        account: account(),
        snapshot: snapshot(),
        attemptToken: 'attacker-chosen',
        origin: 'https://app.mneia.dev',
      }),
    ).toThrow(/UUID/);
  });
});

describe('portalRequestFor', () => {
  it('lets a lead manage a cancelled subscription through the retained customer', () => {
    expect(
      portalRequestFor({
        account: account(),
        snapshot: snapshot({ billingStatus: 'canceled', billingCustomerRef: 'cus_cancelled' }),
        attemptToken: ATTEMPT,
        origin: 'https://app.mneia.dev',
      }),
    ).toEqual({
      customerId: 'cus_cancelled',
      returnUrl: 'https://app.mneia.dev/billing',
      idempotencyKey: ATTEMPT,
    });
  });

  it('refuses a portal request without a Stripe customer', () => {
    expect(() =>
      portalRequestFor({
        account: account(),
        snapshot: snapshot(),
        attemptToken: ATTEMPT,
        origin: 'https://app.mneia.dev',
      }),
    ).toThrow(/customer/);
  });
});

describe('stripeHostedRedirectUrl', () => {
  it('accepts a hosted Stripe checkout URL and refuses an arbitrary HTTPS redirect', () => {
    expect(stripeHostedRedirectUrl('https://checkout.stripe.com/c/pay/cs_test_1')).toBe(
      'https://checkout.stripe.com/c/pay/cs_test_1',
    );
    expect(() => stripeHostedRedirectUrl('https://example.test/pay')).toThrow(/Stripe-hosted/);
  });
});
