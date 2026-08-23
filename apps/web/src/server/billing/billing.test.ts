import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { BillingSnapshot, BillingStore, BillingSubscriptionRef } from './billing-store.js';
import type { StripeConfiguration, StripeSubscription } from './stripe.js';

vi.mock('server-only', () => ({}));

const {
  billingStatusFor,
  hasTeamEntitlement,
  planSeatChange,
  seatsRequiredFor,
  stateAfterSubscription,
} = await import('./seats.js');
const {
  BillingError,
  decodeSubscription,
  parseSignatureHeader,
  planForPriceId,
  readStripeConfiguration,
  requireStripeConfiguration,
  SEAT_PRICE_USD_CENTS,
  StripeClient,
  verifyWebhookSignature,
} = await import('./stripe.js');
const { handleStripeWebhook } = await import('./webhook.js');

const CONFIG: StripeConfiguration = {
  secretKey: 'sk_test',
  priceId: 'price_1',
  proPriceId: 'price_pro',
  webhookSecret: 'whsec_test',
};
const NOW = new Date('2026-08-08T12:00:00.000Z');
const WORKSPACE = '11111111-1111-4111-8111-111111111111';

const signed = (payload: string, secret = CONFIG.webhookSecret, at = NOW): string => {
  const timestamp = Math.floor(at.getTime() / 1000);
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
};

const subscriptionEvent = (
  overrides: Record<string, unknown> = {},
  eventType = 'customer.subscription.updated',
): string =>
  JSON.stringify({
    id: 'evt_1',
    type: eventType,
    data: {
      object: {
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        metadata: { workspace_id: WORKSPACE },
        items: { data: [{ id: 'si_1', quantity: 4, price: { id: 'price_1' } }] },
        ...overrides,
      },
    },
  });

/**
 * The default read-back: Stripe agrees with the event body.
 *
 * Every delivery now reads the subscription back before acting on it, so a test that only
 * cares about the event says so by echoing it. A test about ordering passes its own reader
 * returning something the event does not say, which is exactly the case that used to be
 * applied blind.
 */
const echoSubscription = (payload: string) => async (): Promise<StripeSubscription> => {
  const event = JSON.parse(payload) as { data?: { object?: unknown } };
  return decodeSubscription(event.data?.object);
};

interface Delivery {
  readonly payload: string;
  readonly signatureHeader: string;
  readonly store: BillingStore;
  readonly configuration?: StripeConfiguration;
  readonly now?: Date;
  readonly readSubscription?: (subscriptionId: string) => Promise<StripeSubscription>;
}

const deliver = async (input: Delivery) =>
  handleStripeWebhook({
    payload: input.payload,
    signatureHeader: input.signatureHeader,
    store: input.store,
    configuration: input.configuration ?? CONFIG,
    now: input.now ?? NOW,
    readSubscription: input.readSubscription ?? echoSubscription(input.payload),
  });

const storeStub = (overrides: Partial<BillingStore> = {}): BillingStore => {
  const applied: BillingSnapshot[] = [];
  const appliedRefs: (BillingSubscriptionRef | undefined)[] = [];
  const base: BillingStore = {
    snapshot: async () => ({
      workspaceId: WORKSPACE,
      plan: 'solo',
      billingStatus: 'active',
      seatsPurchased: null,
      billingCustomerRef: null,
      memberCount: 3,
    }),
    subscriptionRef: async () => ({ subscriptionRef: null, itemRef: null }),
    applyBillingState: async ({ workspaceId, state, subscription }) => {
      const snapshot = { workspaceId, ...state, memberCount: 3 };
      applied.push(snapshot);
      appliedRefs.push(subscription);
      return snapshot;
    },
    ...overrides,
  };
  return Object.assign(base, { applied, appliedRefs });
};

const statefulStoreStub = (initial: BillingSnapshot): BillingStore => {
  let snapshot = initial;
  const base: BillingStore = {
    snapshot: async () => snapshot,
    subscriptionRef: async () => ({ subscriptionRef: null, itemRef: null }),
    applyBillingState: async ({ workspaceId, state }) => {
      snapshot = { workspaceId, ...state, memberCount: snapshot.memberCount };
      return snapshot;
    },
  };
  return base;
};

describe('seatsRequiredFor', () => {
  it('never bills fewer than one seat, even for an empty workspace', () => {
    expect(seatsRequiredFor(0)).toEqual({ members: 0, seats: 1 });
  });

  it('bills one seat per member', () => {
    expect(seatsRequiredFor(7).seats).toBe(7);
  });

  it('refuses a nonsense member count rather than billing on it', () => {
    expect(() => seatsRequiredFor(-1)).toThrow(BillingError);
    expect(() => seatsRequiredFor(1.5)).toThrow(BillingError);
  });
});

describe('planSeatChange', () => {
  it('reports an increase as prorated', () => {
    expect(planSeatChange(3, 5)).toEqual({
      from: 3,
      to: 5,
      direction: 'increase',
      prorated: true,
    });
  });

  it('reports a decrease as prorated too, so a removed seat is credited', () => {
    expect(planSeatChange(5, 2).direction).toBe('decrease');
    expect(planSeatChange(5, 2).prorated).toBe(true);
  });

  it('prorates nothing when the seat count has not moved', () => {
    expect(planSeatChange(4, 4)).toEqual({
      from: 4,
      to: 4,
      direction: 'unchanged',
      prorated: false,
    });
  });
});

describe('billingStatusFor', () => {
  it.each([
    ['active', 'active'],
    ['trialing', 'trialing'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['incomplete', 'past_due'],
    ['canceled', 'canceled'],
    ['paused', 'canceled'],
  ])('maps Stripe %s to %s', (stripeStatus, expected) => {
    expect(billingStatusFor(stripeStatus)).toBe(expected);
  });

  it('refuses an unmapped status rather than guessing what to bill', () => {
    expect(() => billingStatusFor('something_new')).toThrow(/refused rather than guessed/);
  });
});

describe('hasTeamEntitlement', () => {
  it.each([
    [{ plan: 'team', billingStatus: 'active', seatsPurchased: 4 }, true],
    [{ plan: 'team', billingStatus: 'trialing', seatsPurchased: 4 }, true],
    [{ plan: 'team', billingStatus: 'past_due', seatsPurchased: 4 }, true],
    [{ plan: 'solo', billingStatus: 'past_due', seatsPurchased: null }, false],
    [{ plan: 'team', billingStatus: 'canceled', seatsPurchased: 4 }, false],
    [{ plan: 'team', billingStatus: 'past_due', seatsPurchased: null }, false],
  ] as const)('has Team entitlement for billing state %o: %s', (state, expected) => {
    expect(hasTeamEntitlement({ ...state, billingCustomerRef: 'cus_1' })).toBe(expected);
  });
});

describe('stateAfterSubscription', () => {
  const current = {
    plan: 'solo' as const,
    billingStatus: 'active' as const,
    seatsPurchased: null,
    billingCustomerRef: null,
  };

  it('moves a paying workspace to the team plan with its seat count', () => {
    expect(
      stateAfterSubscription({
        current,
        subscriptionStatus: 'active',
        seats: 4,
        customerRef: 'cus_1',
      }),
    ).toEqual({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 4,
      billingCustomerRef: 'cus_1',
    });
  });

  it('drops a cancelled workspace back to solo and releases its seats', () => {
    const next = stateAfterSubscription({
      current: { ...current, plan: 'team', seatsPurchased: 4 },
      subscriptionStatus: 'canceled',
      seats: 4,
      customerRef: 'cus_1',
    });

    expect(next.plan).toBe('solo');
    expect(next.seatsPurchased).toBeNull();
    expect(next.billingStatus).toBe('canceled');
  });

  it.each(['canceled', 'unpaid', 'incomplete'])(
    'never silently downgrades a Pro workspace to solo on a %s webhook',
    (subscriptionStatus) => {
      const next = stateAfterSubscription({
        current: { ...current, plan: 'pro' },
        subscriptionStatus,
        seats: 1,
        customerRef: 'cus_1',
      });

      expect(next.plan).toBe('pro');
      expect(next.seatsPurchased).toBeNull();
    },
  );

  it('still promotes a Pro workspace that buys a team subscription', () => {
    const next = stateAfterSubscription({
      current: { ...current, plan: 'pro' },
      subscriptionStatus: 'active',
      seats: 3,
      customerRef: 'cus_1',
    });

    expect(next.plan).toBe('team');
    expect(next.seatsPurchased).toBe(3);
  });

  it('keeps enterprise sticky, as it already was', () => {
    const next = stateAfterSubscription({
      current: { ...current, plan: 'enterprise' },
      subscriptionStatus: 'canceled',
      seats: 4,
      customerRef: 'cus_1',
    });

    expect(next.plan).toBe('enterprise');
  });

  it.each(['unpaid', 'incomplete'])(
    'records a retryable failed-payment Stripe status without Team entitlement',
    (subscriptionStatus) => {
      const next = stateAfterSubscription({
        current: { ...current, plan: 'team', seatsPurchased: 4 },
        subscriptionStatus,
        seats: 4,
        customerRef: 'cus_1',
      });

      expect(next).toMatchObject({
        plan: 'solo',
        billingStatus: 'past_due',
        seatsPurchased: null,
      });
      expect(hasTeamEntitlement(next)).toBe(false);
    },
  );

  it('keeps a past-due subscription on Team entitlement and preserves its seats', () => {
    expect(
      stateAfterSubscription({
        current,
        subscriptionStatus: 'past_due',
        seats: 4,
        customerRef: 'cus_1',
      }),
    ).toMatchObject({
      plan: 'team',
      billingStatus: 'past_due',
      seatsPurchased: 4,
    });
  });

  it('leaves an enterprise workspace on enterprise when its subscription lapses', () => {
    const next = stateAfterSubscription({
      current: { ...current, plan: 'enterprise' },
      subscriptionStatus: 'past_due',
      seats: 9,
      customerRef: 'cus_1',
    });

    expect(next.plan).toBe('enterprise');
  });

  it('leaves an enterprise workspace on enterprise when a subscription is canceled', () => {
    const next = stateAfterSubscription({
      current: { ...current, plan: 'enterprise', seatsPurchased: 9 },
      subscriptionStatus: 'canceled',
      seats: 9,
      customerRef: 'cus_1',
    });

    expect(next).toMatchObject({
      plan: 'enterprise',
      billingStatus: 'canceled',
      seatsPurchased: null,
    });
  });

  it('keeps a trialing workspace on the team plan', () => {
    expect(
      stateAfterSubscription({
        current,
        subscriptionStatus: 'trialing',
        seats: 2,
        customerRef: 'cus_1',
      }).plan,
    ).toBe('team');
  });
});

describe('readStripeConfiguration', () => {
  it('returns null unless all three variables are set, so a half-configured path never runs', () => {
    expect(readStripeConfiguration({})).toBeNull();
    expect(readStripeConfiguration({ STRIPE_SECRET_KEY: 'sk' })).toBeNull();
    expect(readStripeConfiguration({ STRIPE_SECRET_KEY: 'sk', STRIPE_PRICE_ID: 'p' })).toBeNull();
    expect(
      readStripeConfiguration({
        STRIPE_SECRET_KEY: 'sk',
        STRIPE_PRICE_ID: 'p',
        STRIPE_WEBHOOK_SECRET: '  ',
      }),
    ).toBeNull();
  });

  it('reads the configuration when everything is present', () => {
    expect(
      readStripeConfiguration({
        STRIPE_SECRET_KEY: ' sk ',
        STRIPE_PRICE_ID: 'price_1',
        STRIPE_WEBHOOK_SECRET: 'whsec',
      }),
    ).toEqual({ secretKey: 'sk', priceId: 'price_1', proPriceId: null, webhookSecret: 'whsec' });
  });

  it('reads the optional Pro price when it is set, and leaves it null when it is not', () => {
    expect(
      readStripeConfiguration({
        STRIPE_SECRET_KEY: 'sk',
        STRIPE_PRICE_ID: 'price_team',
        STRIPE_PRICE_ID_PRO: ' price_pro ',
        STRIPE_WEBHOOK_SECRET: 'whsec',
      })?.proPriceId,
    ).toBe('price_pro');

    expect(
      readStripeConfiguration({
        STRIPE_SECRET_KEY: 'sk',
        STRIPE_PRICE_ID: 'price_team',
        STRIPE_PRICE_ID_PRO: '   ',
        STRIPE_WEBHOOK_SECRET: 'whsec',
      })?.proPriceId,
    ).toBeNull();
  });

  it('names every missing variable when something demands configuration', () => {
    expect(() => requireStripeConfiguration({})).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => requireStripeConfiguration({})).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it('prices a seat at the §14 figure', () => {
    expect(SEAT_PRICE_USD_CENTS).toBe(2500);
  });
});

describe('verifyWebhookSignature', () => {
  const payload = '{"id":"evt_1"}';

  it('accepts a correctly signed payload', () => {
    expect(() =>
      verifyWebhookSignature({
        payload,
        header: signed(payload),
        secret: CONFIG.webhookSecret,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it('refuses a payload signed with a different secret', () => {
    expect(() =>
      verifyWebhookSignature({
        payload,
        header: signed(payload, 'whsec_other'),
        secret: CONFIG.webhookSecret,
        now: NOW,
      }),
    ).toThrow(/no v1 signature/);
  });

  it('refuses a body that changed after signing', () => {
    expect(() =>
      verifyWebhookSignature({
        payload: '{"id":"evt_tampered"}',
        header: signed(payload),
        secret: CONFIG.webhookSecret,
        now: NOW,
      }),
    ).toThrow(/no v1 signature/);
  });

  it('refuses a replayed event outside the tolerance window', () => {
    const old = new Date(NOW.getTime() - 3_600_000);

    expect(() =>
      verifyWebhookSignature({
        payload,
        header: signed(payload, CONFIG.webhookSecret, old),
        secret: CONFIG.webhookSecret,
        now: NOW,
      }),
    ).toThrow(/beyond the 300s tolerance/);
  });

  it('refuses a header missing the parts it needs', () => {
    expect(() => parseSignatureHeader('t=123')).toThrow(BillingError);
    expect(() => parseSignatureHeader('v1=abc')).toThrow(BillingError);
  });
});

describe('decodeSubscription', () => {
  it('reads the seat quantity off the first subscription item', () => {
    expect(
      decodeSubscription({
        id: 'sub_1',
        status: 'active',
        customer: 'cus_1',
        items: { data: [{ quantity: 6, price: { id: 'price_1' } }] },
      }),
    ).toEqual({
      id: 'sub_1',
      status: 'active',
      quantity: 6,
      customerId: 'cus_1',
      priceId: 'price_1',
      itemId: null,
    });
  });

  it('reports no price rather than inventing one when the item carries none', () => {
    expect(
      decodeSubscription({ id: 'sub_1', status: 'active', items: { data: [{ quantity: 1 }] } })
        .priceId,
    ).toBeNull();
  });

  it('accepts an expanded customer object as well as a bare id', () => {
    expect(
      decodeSubscription({ id: 'sub_1', status: 'active', customer: { id: 'cus_2' } }).customerId,
    ).toBe('cus_2');
  });

  it('refuses a payload with no id or status rather than deriving a billing state from it', () => {
    expect(() => decodeSubscription({ status: 'active' })).toThrow(/refusing to write a billing/);
  });
});

describe('planForPriceId', () => {
  it('maps the configured Team and Pro prices, and refuses everything else', () => {
    expect(planForPriceId(CONFIG, 'price_1')).toBe('team');
    expect(planForPriceId(CONFIG, 'price_pro')).toBe('pro');
    expect(planForPriceId(CONFIG, 'price_someone_made_in_the_dashboard')).toBeNull();
    expect(planForPriceId(CONFIG, null)).toBeNull();
    expect(planForPriceId(CONFIG, '')).toBeNull();
  });

  it('recognises no Pro price at all when one is not configured', () => {
    expect(planForPriceId({ ...CONFIG, proPriceId: null }, 'price_pro')).toBeNull();
  });
});

describe('StripeClient', () => {
  it('reads a subscription back with a GET, so a late event applies current state', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: 'sub_1',
            status: 'past_due',
            customer: 'cus_1',
            items: { data: [{ id: 'si_live', quantity: 2, price: { id: 'price_1' } }] },
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const client = new StripeClient({ configuration: CONFIG, fetchImpl });

    await expect(client.retrieveSubscription('sub_1')).resolves.toEqual({
      id: 'sub_1',
      status: 'past_due',
      quantity: 2,
      customerId: 'cus_1',
      priceId: 'price_1',
      itemId: 'si_live',
    });

    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/subscriptions/sub_1');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.headers).toMatchObject({ authorization: 'Bearer sk_test' });
  });

  it('creates a subscription Checkout Session bound to the workspace', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'cs_1', url: 'https://checkout.stripe.test/session' }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    const client = new StripeClient({ configuration: CONFIG, fetchImpl });
    const session = await client.createCheckoutSession({
      workspaceId: WORKSPACE,
      customerId: 'cus_1',
      seats: 3,
      successUrl: 'https://app.mneia.dev/billing?checkout=success',
      cancelUrl: 'https://app.mneia.dev/billing?checkout=canceled',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });

    expect(session).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test/session' });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      mode: 'subscription',
      'line_items[0][price]': CONFIG.priceId,
      'line_items[0][quantity]': '3',
      client_reference_id: WORKSPACE,
      'metadata[workspace_id]': WORKSPACE,
      'subscription_data[metadata][workspace_id]': WORKSPACE,
      customer: 'cus_1',
      success_url: 'https://app.mneia.dev/billing?checkout=success',
      cancel_url: 'https://app.mneia.dev/billing?checkout=canceled',
    });
    expect(init.headers).toMatchObject({
      'Idempotency-Key': '11111111-1111-4111-8111-111111111111',
    });
  });

  it('creates a Billing Portal Session with the customer and return URL', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: 'bps_1', url: 'https://billing.stripe.test/session' }), {
          status: 200,
        }),
    ) as unknown as typeof fetch;

    const client = new StripeClient({ configuration: CONFIG, fetchImpl });
    const session = await client.createPortalSession({
      customerId: 'cus_1',
      returnUrl: 'https://app.mneia.dev/billing',
    });

    expect(session).toEqual({ id: 'bps_1', url: 'https://billing.stripe.test/session' });
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/billing_portal/sessions');
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      customer: 'cus_1',
      return_url: 'https://app.mneia.dev/billing',
    });
  });

  it.each([
    [{ url: 'https://checkout.stripe.test/session' }, /non-empty session id/],
    [{ id: 'cs_1' }, /HTTPS session URL/],
    [{ id: 'cs_1', url: 'http://checkout.stripe.test/session' }, /HTTPS session URL/],
    [{ id: 'cs_1', url: 'not-a-url' }, /HTTPS session URL/],
  ])('refuses an invalid Stripe hosted session response: %o', async (payload, message) => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify(payload), { status: 200 }),
    ) as unknown as typeof fetch;
    const client = new StripeClient({ configuration: CONFIG, fetchImpl });

    await expect(
      client.createCheckoutSession({
        workspaceId: WORKSPACE,
        seats: 3,
        successUrl: 'https://app.mneia.dev/billing?checkout=success',
        cancelUrl: 'https://app.mneia.dev/billing?checkout=canceled',
      }),
    ).rejects.toMatchObject({ code: 'invalid_payload', message: expect.stringMatching(message) });
  });

  it('creates a customer carrying the workspace id in metadata', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: 'cus_9' }), { status: 200 }),
    ) as unknown as typeof fetch;

    const client = new StripeClient({ configuration: CONFIG, fetchImpl });
    const customer = await client.createCustomer({
      workspaceId: WORKSPACE,
      email: 'lead@acme.test',
      name: 'Acme',
    });

    expect(customer.id).toBe('cus_9');
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain(`metadata%5Bworkspace_id%5D=${WORKSPACE}`);
  });

  it('asks Stripe to prorate a seat change', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ id: 'sub_1', status: 'active', items: { data: [{ quantity: 5 }] } }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch;

    const client = new StripeClient({ configuration: CONFIG, fetchImpl });
    const updated = await client.updateSeats({
      subscriptionId: 'sub_1',
      subscriptionItemId: 'si_1',
      seats: 5,
    });

    expect(updated.quantity).toBe(5);
    const [, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0] as [string, RequestInit];
    expect(String(init.body)).toContain('proration_behavior=create_prorations');
  });

  it('reports a refusal from Stripe with the message Stripe gave', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'No such price' } }), {
          status: 400,
          statusText: 'Bad Request',
        }),
    ) as unknown as typeof fetch;

    const client = new StripeClient({ configuration: CONFIG, fetchImpl });

    await expect(
      client.createSubscription({ customerId: 'cus_1', seats: 2, workspaceId: WORKSPACE }),
    ).rejects.toThrow(/No such price/);
  });

  it('says nothing can be assumed when the request dies in transit', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;

    const client = new StripeClient({ configuration: CONFIG, fetchImpl });

    await expect(client.cancelSubscription('sub_1')).rejects.toThrow(/nothing can be assumed/);
  });
});

describe('handleStripeWebhook', () => {
  it('applies a subscription update to the workspace named in metadata', async () => {
    const store = storeStub();
    const payload = subscriptionEvent();

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      configuration: CONFIG,
      store,
      now: NOW,
    });

    expect(outcome.applied).toBe(true);
    expect(outcome.workspaceId).toBe(WORKSPACE);
    const applied = (store as unknown as { applied: { plan: string; seatsPurchased: number }[] })
      .applied;
    expect(applied[0]).toMatchObject({ plan: 'team', seatsPurchased: 4 });
  });

  it('refuses an event whose signature does not verify, before touching the store', async () => {
    const store = storeStub();
    const payload = subscriptionEvent();

    await expect(
      deliver({
        payload,
        signatureHeader: signed(payload, 'whsec_wrong'),
        configuration: CONFIG,
        store,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });

    expect((store as unknown as { applied: unknown[] }).applied).toHaveLength(0);
  });

  it('ignores an event type it does not act on, without failing the delivery', async () => {
    const payload = JSON.stringify({ id: 'evt_2', type: 'invoice.paid', data: { object: {} } });

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      configuration: CONFIG,
      store: storeStub(),
      now: NOW,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toContain('not one of the events');
  });

  it('declines an event with no workspace_id in metadata, and says why there is no fallback', async () => {
    const payload = subscriptionEvent({ metadata: {} });

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      configuration: CONFIG,
      store: storeStub(),
      now: NOW,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toContain('no workspace_id in its metadata');
    expect(outcome.reason).toContain('ROW LEVEL SECURITY');
  });
  it('treats a deletion as cancelled whatever status the object carries', async () => {
    const store = storeStub();
    const payload = subscriptionEvent({ status: 'active' }, 'customer.subscription.deleted');

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      configuration: CONFIG,
      store,
      now: NOW,
    });

    expect(outcome.applied).toBe(true);
    const applied = (store as unknown as { applied: { plan: string }[] }).applied;
    expect(applied[0]?.plan).toBe('solo');
  });

  it('allows a same-customer active update to recover from incomplete', async () => {
    const store = statefulStoreStub({
      workspaceId: WORKSPACE,
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 4,
      billingCustomerRef: 'cus_1',
      memberCount: 3,
    });
    const incomplete = subscriptionEvent({ status: 'incomplete' });

    await expect(
      deliver({
        payload: incomplete,
        signatureHeader: signed(incomplete),
        configuration: CONFIG,
        store,
        now: NOW,
      }),
    ).resolves.toMatchObject({ applied: true });
    await expect(store.snapshot(WORKSPACE)).resolves.toMatchObject({
      plan: 'solo',
      billingStatus: 'past_due',
      seatsPurchased: null,
    });

    const recovery = subscriptionEvent({ status: 'active' });
    await expect(
      deliver({
        payload: recovery,
        signatureHeader: signed(recovery),
        configuration: CONFIG,
        store,
        now: NOW,
      }),
    ).resolves.toMatchObject({ applied: true });
    await expect(store.snapshot(WORKSPACE)).resolves.toMatchObject({
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 4,
    });
  });

  it('does not revive a same-customer subscription after a deletion', async () => {
    const store = statefulStoreStub({
      workspaceId: WORKSPACE,
      plan: 'team',
      billingStatus: 'active',
      seatsPurchased: 4,
      billingCustomerRef: 'cus_1',
      memberCount: 3,
    });
    const deletion = subscriptionEvent({}, 'customer.subscription.deleted');

    await expect(
      deliver({
        payload: deletion,
        signatureHeader: signed(deletion),
        configuration: CONFIG,
        store,
        now: NOW,
      }),
    ).resolves.toMatchObject({ applied: true });

    const lateUpdate = subscriptionEvent({ status: 'active' });
    await expect(
      deliver({
        payload: lateUpdate,
        signatureHeader: signed(lateUpdate),
        configuration: CONFIG,
        store,
        now: NOW,
      }),
    ).resolves.toMatchObject({ applied: false });
  });

  const cancelled = (customerRef: string) =>
    storeStub({
      snapshot: async () => ({
        workspaceId: WORKSPACE,
        plan: 'solo',
        billingStatus: 'canceled',
        seatsPurchased: null,
        billingCustomerRef: customerRef,
        memberCount: 3,
      }),
    });

  it('ignores a late .updated that would revive a cancelled workspace', async () => {
    const store = cancelled('cus_1');
    const payload = subscriptionEvent({ status: 'active' });

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      configuration: CONFIG,
      store,
      now: NOW,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toContain('would revive it');
    expect((store as unknown as { applied: unknown[] }).applied).toHaveLength(0);
  });

  it('still applies a cancellation to an already cancelled workspace, which is idempotent', async () => {
    const payload = subscriptionEvent({}, 'customer.subscription.deleted');

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      configuration: CONFIG,
      store: cancelled('cus_1'),
      now: NOW,
    });

    expect(outcome.applied).toBe(true);
  });

  it('lets a different customer move a cancelled workspace back onto a plan', async () => {
    const payload = subscriptionEvent({ status: 'active', customer: 'cus_new' });

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      configuration: CONFIG,
      store: cancelled('cus_old'),
      now: NOW,
    });

    expect(outcome.applied).toBe(true);
  });

  it('declines when the workspace named does not exist here', async () => {
    const outcome = await deliver({
      payload: subscriptionEvent(),
      signatureHeader: signed(subscriptionEvent()),
      configuration: CONFIG,
      store: storeStub({ snapshot: async () => null }),
      now: NOW,
    });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toContain('does not exist');
  });

  it('applies what Stripe holds now, not what a stale event body says', async () => {
    const store = storeStub();
    // The event was signed while the subscription was live. By the time it is delivered
    // Stripe has cancelled it. Before the read-back this wrote plan team, seats 4.
    const payload = subscriptionEvent({ status: 'active' });

    const outcome = await deliver({
      payload,
      signatureHeader: signed(payload),
      store,
      readSubscription: async () => ({
        id: 'sub_1',
        status: 'canceled',
        quantity: 4,
        customerId: 'cus_1',
        priceId: 'price_1',
        itemId: 'si_1',
      }),
    });

    expect(outcome.applied).toBe(true);
    const applied = (store as unknown as { applied: BillingSnapshot[] }).applied;
    expect(applied[0]).toMatchObject({
      plan: 'solo',
      billingStatus: 'canceled',
      seatsPurchased: null,
    });
  });

  it('writes nothing when the subscription cannot be read back, so Stripe redelivers', async () => {
    const store = storeStub();
    const payload = subscriptionEvent();

    await expect(
      deliver({
        payload,
        signatureHeader: signed(payload),
        store,
        readSubscription: async () => {
          throw new BillingError('stripe_unreachable', 'connection reset');
        },
      }),
    ).rejects.toMatchObject({ code: 'stripe_unreachable' });

    expect((store as unknown as { applied: unknown[] }).applied).toHaveLength(0);
  });

  it('converges rather than doubling when the same event is delivered twice', async () => {
    const store = statefulStoreStub({
      workspaceId: WORKSPACE,
      plan: 'solo',
      billingStatus: 'active',
      seatsPurchased: null,
      billingCustomerRef: null,
      memberCount: 3,
    });
    const payload = subscriptionEvent();

    await deliver({ payload, signatureHeader: signed(payload), store });
    const first = await store.snapshot(WORKSPACE);
    await deliver({ payload, signatureHeader: signed(payload), store });

    expect(await store.snapshot(WORKSPACE)).toEqual(first);
    expect(first).toMatchObject({ plan: 'team', seatsPurchased: 4 });
  });

  it('grants Pro, not Team, for a subscription on the Pro price', async () => {
    const store = storeStub();
    const payload = subscriptionEvent({
      items: { data: [{ id: 'si_1', quantity: 1, price: { id: 'price_pro' } }] },
    });

    const outcome = await deliver({ payload, signatureHeader: signed(payload), store });

    expect(outcome.applied).toBe(true);
    const applied = (store as unknown as { applied: BillingSnapshot[] }).applied;
    expect(applied[0]).toMatchObject({ plan: 'pro', billingStatus: 'active' });
  });

  it('grants nothing for a price it does not recognise, rather than defaulting to Team', async () => {
    const store = storeStub();
    const payload = subscriptionEvent({
      items: { data: [{ id: 'si_1', quantity: 9, price: { id: 'price_mystery' } }] },
    });

    const outcome = await deliver({ payload, signatureHeader: signed(payload), store });

    expect(outcome.applied).toBe(false);
    expect(outcome.reason).toContain('price_mystery');
    expect(outcome.reason).toContain('STRIPE_PRICE_ID');
    expect((store as unknown as { applied: unknown[] }).applied).toHaveLength(0);
  });

  it('records the subscription and item ids from the live object, so seats can be pushed back', async () => {
    const store = storeStub();
    const payload = subscriptionEvent();

    await deliver({
      payload,
      signatureHeader: signed(payload),
      store,
      // The event body says si_1. Stripe says si_live. The stored address must be what
      // Stripe says, or updateSeats addresses an item that no longer exists.
      readSubscription: async () => ({
        id: 'sub_live',
        status: 'active',
        quantity: 4,
        customerId: 'cus_1',
        priceId: 'price_1',
        itemId: 'si_live',
      }),
    });

    const refs = (store as unknown as { appliedRefs: (BillingSubscriptionRef | undefined)[] })
      .appliedRefs;
    expect(refs[0]).toEqual({ subscriptionRef: 'sub_live', itemRef: 'si_live' });
  });

  it('clears the recorded subscription on cancellation, so no later change addresses it', async () => {
    const store = storeStub();
    const payload = subscriptionEvent({}, 'customer.subscription.deleted');

    await deliver({ payload, signatureHeader: signed(payload), store });

    const refs = (store as unknown as { appliedRefs: (BillingSubscriptionRef | undefined)[] })
      .appliedRefs;
    expect(refs[0]).toEqual({ subscriptionRef: null, itemRef: null });
  });

  it('still cancels a subscription on an unrecognised price, so nothing stays entitled', async () => {
    const store = storeStub({
      snapshot: async () => ({
        workspaceId: WORKSPACE,
        plan: 'team',
        billingStatus: 'active',
        seatsPurchased: 4,
        billingCustomerRef: 'cus_1',
        memberCount: 3,
      }),
    });
    const payload = subscriptionEvent(
      { items: { data: [{ id: 'si_1', quantity: 4, price: { id: 'price_mystery' } }] } },
      'customer.subscription.deleted',
    );

    const outcome = await deliver({ payload, signatureHeader: signed(payload), store });

    expect(outcome.applied).toBe(true);
    const applied = (store as unknown as { applied: BillingSnapshot[] }).applied;
    expect(applied[0]).toMatchObject({
      plan: 'solo',
      billingStatus: 'canceled',
      seatsPurchased: null,
    });
  });
});
