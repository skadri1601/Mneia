import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

export const STRIPE_SECRET_KEY_VAR = 'STRIPE_SECRET_KEY';
export const STRIPE_WEBHOOK_SECRET_VAR = 'STRIPE_WEBHOOK_SECRET';
export const STRIPE_PRICE_ID_VAR = 'STRIPE_PRICE_ID';

const STRIPE_API = 'https://api.stripe.com/v1';

export const SEAT_PRICE_USD_CENTS = 2500;

export type BillingErrorCode =
  | 'not_configured'
  | 'stripe_refused'
  | 'stripe_unreachable'
  | 'invalid_signature'
  | 'invalid_payload';

export class BillingError extends Error {
  readonly code: BillingErrorCode;

  constructor(code: BillingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BillingError';
    this.code = code;
  }
}

export interface StripeConfiguration {
  readonly secretKey: string;
  readonly priceId: string;
  readonly webhookSecret: string;
}

export interface StripeClientOptions {
  readonly configuration: StripeConfiguration;
  readonly fetchImpl?: typeof fetch;
}

const form = (fields: Readonly<Record<string, string | number | undefined>>): string => {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      body.set(key, String(value));
    }
  }
  return body.toString();
};

export interface StripeCustomer {
  readonly id: string;
}

export interface StripeSubscription {
  readonly id: string;
  readonly status: string;
  readonly quantity: number | null;
  readonly customerId: string | null;
}

export interface StripeHostedSession {
  readonly id: string;
  readonly url: string;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const decodeHostedSession = (payload: unknown): StripeHostedSession => {
  const record = asRecord(payload);
  const id = asString(record.id);
  if (id === null || id.trim() === '') {
    throw new BillingError(
      'invalid_payload',
      'expected Stripe to return a non-empty session id; received a hosted-session payload without one',
    );
  }

  const url = asString(record.url);
  if (url === null) {
    throw new BillingError(
      'invalid_payload',
      'expected Stripe to return an HTTPS session URL; received a hosted-session payload without one',
    );
  }

  try {
    if (new URL(url).protocol !== 'https:') {
      throw new Error('not HTTPS');
    }
  } catch {
    throw new BillingError(
      'invalid_payload',
      `expected Stripe to return an HTTPS session URL; received "${url.slice(0, 120)}"`,
    );
  }

  return { id, url };
};

const firstItemQuantity = (payload: Record<string, unknown>): number | null => {
  const items = asRecord(payload.items).data;
  if (!Array.isArray(items)) {
    return null;
  }
  const quantity = asRecord(items[0]).quantity;
  return typeof quantity === 'number' ? quantity : null;
};

export const decodeSubscription = (payload: unknown): StripeSubscription => {
  const record = asRecord(payload);
  const id = asString(record.id);
  const status = asString(record.status);

  if (id === null || status === null) {
    throw new BillingError(
      'invalid_payload',
      `expected a Stripe subscription object carrying id and status; received keys [${Object.keys(record).join(', ')}] — refusing to write a billing state derived from an unrecognised payload`,
    );
  }

  const customer = record.customer;
  return {
    id,
    status,
    quantity: firstItemQuantity(record),
    customerId: asString(customer) ?? asString(asRecord(customer).id),
  };
};

export class StripeClient {
  private readonly configuration: StripeConfiguration;
  private readonly fetchImpl: typeof fetch;

  constructor(options: StripeClientOptions) {
    this.configuration = options.configuration;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async post(path: string, body: string, idempotencyKey?: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${STRIPE_API}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.configuration.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
        },
        body,
      });
    } catch (cause) {
      throw new BillingError(
        'stripe_unreachable',
        `the request to Stripe ${path} failed in transit (${cause instanceof Error ? cause.message : String(cause)}); nothing can be assumed about whether it applied — read the subscription back before retrying`,
        { cause },
      );
    }

    const payload: unknown = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = asString(asRecord(asRecord(payload).error).message);
      throw new BillingError(
        'stripe_refused',
        `Stripe refused ${path} with ${response.status} ${response.statusText}${message === null ? '' : `: ${message}`}`,
      );
    }

    return payload;
  }

  async createCustomer(input: {
    readonly workspaceId: string;
    readonly email: string;
    readonly name: string;
  }): Promise<StripeCustomer> {
    const payload = await this.post(
      '/customers',
      form({
        email: input.email,
        name: input.name,
        'metadata[workspace_id]': input.workspaceId,
      }),
    );
    const id = asString(asRecord(payload).id);
    if (id === null) {
      throw new BillingError(
        'invalid_payload',
        'expected Stripe to return a customer id; received a payload without one',
      );
    }
    return { id };
  }

  async createCheckoutSession(input: {
    readonly workspaceId: string;
    readonly customerId?: string;
    readonly seats: number;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly idempotencyKey?: string;
  }): Promise<StripeHostedSession> {
    return decodeHostedSession(
      await this.post(
        '/checkout/sessions',
        form({
          mode: 'subscription',
          'line_items[0][price]': this.configuration.priceId,
          'line_items[0][quantity]': input.seats,
          'metadata[workspace_id]': input.workspaceId,
          'subscription_data[metadata][workspace_id]': input.workspaceId,
          customer: input.customerId,
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
        }),
        input.idempotencyKey,
      ),
    );
  }

  async createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
    readonly idempotencyKey?: string;
  }): Promise<StripeHostedSession> {
    return decodeHostedSession(
      await this.post(
        '/billing_portal/sessions',
        form({ customer: input.customerId, return_url: input.returnUrl }),
        input.idempotencyKey,
      ),
    );
  }

  async createSubscription(input: {
    readonly customerId: string;
    readonly seats: number;
    readonly workspaceId: string;
  }): Promise<StripeSubscription> {
    return decodeSubscription(
      await this.post(
        '/subscriptions',
        form({
          customer: input.customerId,
          'items[0][price]': this.configuration.priceId,
          'items[0][quantity]': input.seats,
          'metadata[workspace_id]': input.workspaceId,
          proration_behavior: 'create_prorations',
        }),
      ),
    );
  }

  async updateSeats(input: {
    readonly subscriptionId: string;
    readonly subscriptionItemId: string;
    readonly seats: number;
  }): Promise<StripeSubscription> {
    return decodeSubscription(
      await this.post(
        `/subscriptions/${encodeURIComponent(input.subscriptionId)}`,
        form({
          'items[0][id]': input.subscriptionItemId,
          'items[0][quantity]': input.seats,
          proration_behavior: 'create_prorations',
        }),
      ),
    );
  }

  async cancelSubscription(subscriptionId: string): Promise<StripeSubscription> {
    return decodeSubscription(
      await this.post(
        `/subscriptions/${encodeURIComponent(subscriptionId)}`,
        form({ cancel_at_period_end: 'true' }),
      ),
    );
  }
}

export interface SignatureHeaderParts {
  readonly timestamp: string;
  readonly signatures: readonly string[];
}

export const parseSignatureHeader = (header: string): SignatureHeaderParts => {
  const parts = header.split(',').map((part) => part.trim());
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split('=', 2);
    if (key === 't' && value !== undefined) {
      timestamp = value;
    }
    if (key === 'v1' && value !== undefined) {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) {
    throw new BillingError(
      'invalid_signature',
      `expected a Stripe-Signature header carrying a t= timestamp and at least one v1= signature; received "${header.slice(0, 120)}"`,
    );
  }

  return { timestamp, signatures };
};

const matches = (expected: string, candidate: string): boolean => {
  const left = Buffer.from(expected, 'utf8');
  const right = Buffer.from(candidate, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
};

export const TOLERANCE_SECONDS = 300;

export const verifyWebhookSignature = (input: {
  readonly payload: string;
  readonly header: string;
  readonly secret: string;
  readonly now: Date;
  readonly toleranceSeconds?: number;
}): void => {
  const { timestamp, signatures } = parseSignatureHeader(input.header);
  const tolerance = input.toleranceSeconds ?? TOLERANCE_SECONDS;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    throw new BillingError(
      'invalid_signature',
      `expected the Stripe-Signature timestamp to be a unix time in seconds; received "${timestamp}"`,
    );
  }

  const ageSeconds = Math.abs(input.now.getTime() / 1000 - sentAt);
  if (ageSeconds > tolerance) {
    throw new BillingError(
      'invalid_signature',
      `the webhook signature is ${Math.round(ageSeconds)}s old, beyond the ${tolerance}s tolerance — a replayed event is refused rather than applied`,
    );
  }

  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.payload}`, 'utf8')
    .digest('hex');

  if (!signatures.some((candidate) => matches(expected, candidate))) {
    throw new BillingError(
      'invalid_signature',
      'no v1 signature in the Stripe-Signature header matches this payload and the configured webhook secret; the event is refused',
    );
  }
};

export const readStripeConfiguration = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): StripeConfiguration | null => {
  const secretKey = env[STRIPE_SECRET_KEY_VAR]?.trim();
  const priceId = env[STRIPE_PRICE_ID_VAR]?.trim();
  const webhookSecret = env[STRIPE_WEBHOOK_SECRET_VAR]?.trim();

  if (
    secretKey === undefined ||
    secretKey === '' ||
    priceId === undefined ||
    priceId === '' ||
    webhookSecret === undefined ||
    webhookSecret === ''
  ) {
    return null;
  }

  return { secretKey, priceId, webhookSecret };
};

export const requireStripeConfiguration = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): StripeConfiguration => {
  const configuration = readStripeConfiguration(env);
  if (configuration === null) {
    throw new BillingError(
      'not_configured',
      `billing is not configured: ${STRIPE_SECRET_KEY_VAR}, ${STRIPE_PRICE_ID_VAR} and ${STRIPE_WEBHOOK_SECRET_VAR} must all be set. ` +
        'Nothing is charged and no workspace changes plan until they are, which is deliberate — a half-configured billing path is worse than none.',
    );
  }
  return configuration;
};
