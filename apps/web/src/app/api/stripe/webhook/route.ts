import { PostgresBillingStore } from '../../../../server/billing/billing-store.js';
import {
  BillingError,
  readStripeConfiguration,
  StripeClient,
} from '../../../../server/billing/stripe.js';
import { handleStripeWebhook } from '../../../../server/billing/webhook.js';
import { database } from '../../../../server/database.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const statusFor = (code: BillingError['code']): number => {
  switch (code) {
    case 'invalid_signature':
      return 400;
    case 'stripe_unreachable':
    case 'stripe_refused':
    case 'not_configured':
      return 503;
    default:
      return 422;
  }
};

export const POST = async (request: Request): Promise<Response> => {
  const configuration = readStripeConfiguration();

  if (configuration === null) {
    return json(503, {
      status: 'not_configured',
      message:
        'billing is not configured on this deployment, so no Stripe event is applied. This is the expected state until STRIPE_SECRET_KEY, STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET are set.',
    });
  }

  const signatureHeader = request.headers.get('stripe-signature');
  if (signatureHeader === null) {
    return json(400, {
      status: 'error',
      code: 'invalid_signature',
      message: 'expected a Stripe-Signature header; found none',
    });
  }

  // The raw body, before anything parses it. The signature is computed over these exact
  // bytes, so re-serialising a parsed object would verify a different payload than Stripe
  // signed — which is the difference between a verified webhook and a forgeable one.
  const payload = await request.text();
  const stripe = new StripeClient({ configuration });

  try {
    const outcome = await handleStripeWebhook({
      payload,
      signatureHeader,
      configuration,
      store: new PostgresBillingStore(database),
      now: new Date(),
      readSubscription: (subscriptionId) => stripe.retrieveSubscription(subscriptionId),
    });

    return json(200, { status: 'ok', ...outcome });
  } catch (error) {
    if (error instanceof BillingError) {
      // Stripe redelivers on any non-2xx, so the code is for whoever reads the logs. A
      // transient failure reaching Stripe is 503 — the delivery is worth retrying and
      // nothing was written. A bad signature or an unusable body is not, and says so.
      return json(statusFor(error.code), {
        status: 'error',
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }
};
