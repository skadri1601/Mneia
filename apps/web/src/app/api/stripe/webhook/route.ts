import { PostgresBillingStore } from '../../../../server/billing/billing-store.js';
import { BillingError, readStripeConfiguration } from '../../../../server/billing/stripe.js';
import { handleStripeWebhook } from '../../../../server/billing/webhook.js';
import { database } from '../../../../server/database.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

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

  const payload = await request.text();

  try {
    const outcome = await handleStripeWebhook({
      payload,
      signatureHeader,
      configuration,
      store: new PostgresBillingStore(database),
      now: new Date(),
    });

    return json(200, { status: 'ok', ...outcome });
  } catch (error) {
    if (error instanceof BillingError) {
      const status = error.code === 'invalid_signature' ? 400 : 422;
      return json(status, { status: 'error', code: error.code, message: error.message });
    }
    throw error;
  }
};
