import { describe, expect, it, vi } from 'vitest';
import type { BillingSnapshot, BillingStore } from './billing-store.js';
import {
  BillingControlError,
  checkoutRequestFor,
  portalRequestFor,
  StripeSeatSync,
  seatSyncDecisionFor,
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

  it('lets a cancelled workspace subscribe again, on a customer Stripe has not cancelled', () => {
    const request = checkoutRequestFor({
      account: account(),
      snapshot: snapshot({ billingStatus: 'canceled', billingCustomerRef: 'cus_cancelled' }),
      attemptToken: ATTEMPT,
      origin: 'https://app.mneia.dev',
    });

    expect(request.customerId).toBeUndefined();
    expect(request.workspaceId).toBe(WORKSPACE_ID);
  });

  it('reuses the stored customer while the subscription is still live', () => {
    const request = checkoutRequestFor({
      account: account(),
      snapshot: snapshot({ billingStatus: 'active', billingCustomerRef: 'cus_live' }),
      attemptToken: ATTEMPT,
      origin: 'https://app.mneia.dev',
    });

    expect(request.customerId).toBe('cus_live');
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
  it('closes the portal once cancelled, so nobody pays through it for access they will not get', () => {
    expect(() =>
      portalRequestFor({
        account: account(),
        snapshot: snapshot({ billingStatus: 'canceled', billingCustomerRef: 'cus_cancelled' }),
        attemptToken: ATTEMPT,
        origin: 'https://app.mneia.dev',
      }),
    ).toThrow(/actionable billing status/);
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

describe('seatSyncDecisionFor', () => {
  const seated = (overrides: Partial<BillingSnapshot> = {}): BillingSnapshot =>
    snapshot({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 3,
      billingCustomerRef: 'cus_1',
      ...overrides,
    });

  const address = { subscriptionId: 'sub_1', subscriptionItemId: 'si_1' };

  it('raises the quantity when a lead deliberately buys seats', () => {
    const decision = seatSyncDecisionFor({
      snapshot: seated(),
      address,
      desiredSeats: 5,
      intent: 'purchase',
    });

    expect(decision).toEqual({
      sync: true,
      direction: 'increase',
      request: { subscriptionId: 'sub_1', subscriptionItemId: 'si_1', seats: 5 },
    });
  });

  it('refuses to raise the bill for a membership change nobody paid for', () => {
    const decision = seatSyncDecisionFor({
      snapshot: seated(),
      address,
      desiredSeats: 5,
      intent: 'membership',
    });

    expect(decision.sync).toBe(false);
    if (decision.sync) throw new Error('expected the increase to be refused');
    expect(decision.reason).toContain('would increase this workspace');
    expect(decision.reason).toContain('admitOneMoreSeat');
  });

  it('lowers the quantity on a membership change, because that only ever reduces the bill', () => {
    const decision = seatSyncDecisionFor({
      snapshot: seated(),
      address,
      desiredSeats: 2,
      intent: 'membership',
    });

    expect(decision).toMatchObject({ sync: true, direction: 'decrease' });
  });

  it('does nothing when the purchased quantity is already what is needed', () => {
    const decision = seatSyncDecisionFor({
      snapshot: seated(),
      address,
      desiredSeats: 3,
      intent: 'purchase',
    });

    expect(decision.sync).toBe(false);
  });

  it('does nothing for a plan that is not seat-priced', () => {
    for (const plan of ['solo', 'pro', 'enterprise'] as const) {
      const decision = seatSyncDecisionFor({
        snapshot: seated({ plan }),
        address,
        desiredSeats: 9,
        intent: 'purchase',
      });

      expect(decision.sync).toBe(false);
      if (decision.sync) throw new Error('expected no sync');
      expect(decision.reason).toContain('not seat-priced');
    }
  });

  it('never moves the quantity on a cancelled subscription', () => {
    const decision = seatSyncDecisionFor({
      snapshot: seated({ billingStatus: 'canceled' }),
      address,
      desiredSeats: 5,
      intent: 'purchase',
    });

    expect(decision.sync).toBe(false);
  });

  it('says what to do when the workspace has no subscription recorded yet', () => {
    const decision = seatSyncDecisionFor({
      snapshot: seated(),
      address: null,
      desiredSeats: 5,
      intent: 'purchase',
    });

    expect(decision.sync).toBe(false);
    if (decision.sync) throw new Error('expected no sync');
    expect(decision.reason).toContain('migration 0036');
  });

  it('refuses a nonsense quantity rather than sending it to Stripe', () => {
    expect(() =>
      seatSyncDecisionFor({ snapshot: seated(), address, desiredSeats: 0, intent: 'purchase' }),
    ).toThrow(BillingControlError);
    expect(() =>
      seatSyncDecisionFor({ snapshot: seated(), address, desiredSeats: 2.5, intent: 'purchase' }),
    ).toThrow(/integer/);
  });
});

describe('StripeSeatSync', () => {
  const store = (overrides: Partial<BillingStore> = {}): BillingStore => ({
    snapshot: async () =>
      snapshot({
        plan: 'team',
        billingStatus: 'active',
        seatsPurchased: 3,
        billingCustomerRef: 'cus_1',
      }),
    subscriptionRef: async () => ({ subscriptionRef: 'sub_1', itemRef: 'si_1' }),
    applyBillingState: async () => {
      throw new Error('applyBillingState is not part of seat sync');
    },
    ...overrides,
  });

  it('sends the absolute quantity, so applying it twice leaves Stripe in the same place', async () => {
    const updateSeats = vi.fn(async () => ({}));
    const sync = new StripeSeatSync(store(), { updateSeats });

    const first = await sync.purchaseSeats({ workspaceId: WORKSPACE_ID, seats: 5 });
    const second = await sync.purchaseSeats({ workspaceId: WORKSPACE_ID, seats: 5 });

    expect(first).toMatchObject({ synced: true, seats: 5 });
    expect(second).toMatchObject({ synced: true, seats: 5 });
    expect(updateSeats).toHaveBeenNthCalledWith(1, {
      subscriptionId: 'sub_1',
      subscriptionItemId: 'si_1',
      seats: 5,
    });
    expect(updateSeats).toHaveBeenNthCalledWith(2, {
      subscriptionId: 'sub_1',
      subscriptionItemId: 'si_1',
      seats: 5,
    });
  });

  it('does not touch Stripe when a membership change would raise the bill', async () => {
    const updateSeats = vi.fn(async () => ({}));
    const sync = new StripeSeatSync(store(), { updateSeats });

    const outcome = await sync.syncSeats({
      workspaceId: WORKSPACE_ID,
      seats: 6,
      reason: 'member_joined',
    });

    expect(outcome.synced).toBe(false);
    expect(updateSeats).not.toHaveBeenCalled();
  });

  it('releases a seat to Stripe when a member is removed', async () => {
    const updateSeats = vi.fn(async () => ({}));
    const sync = new StripeSeatSync(store(), { updateSeats });

    const outcome = await sync.syncSeats({
      workspaceId: WORKSPACE_ID,
      seats: 2,
      reason: 'member_removed',
    });

    expect(outcome).toMatchObject({ synced: true, seats: 2 });
    expect(updateSeats).toHaveBeenCalledWith({
      subscriptionId: 'sub_1',
      subscriptionItemId: 'si_1',
      seats: 2,
    });
  });

  it('does not reach Stripe when no subscription is recorded', async () => {
    const updateSeats = vi.fn(async () => ({}));
    const sync = new StripeSeatSync(
      store({ subscriptionRef: async () => ({ subscriptionRef: null, itemRef: null }) }),
      { updateSeats },
    );

    const outcome = await sync.purchaseSeats({ workspaceId: WORKSPACE_ID, seats: 5 });

    expect(outcome.synced).toBe(false);
    expect(updateSeats).not.toHaveBeenCalled();
  });
});
