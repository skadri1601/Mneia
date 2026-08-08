import 'server-only';

import type { BillingStore } from './billing-store.js';
import { billingStatusFor, stateAfterSubscription } from './seats.js';
import {
  BillingError,
  decodeSubscription,
  type StripeConfiguration,
  verifyWebhookSignature,
} from './stripe.js';

export const HANDLED_EVENTS = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export type HandledEvent = (typeof HANDLED_EVENTS)[number];

const isHandled = (name: string): name is HandledEvent =>
  (HANDLED_EVENTS as readonly string[]).includes(name);

export interface WebhookOutcome {
  readonly eventId: string;
  readonly eventType: string;
  readonly applied: boolean;
  readonly reason: string | null;
  readonly workspaceId: string | null;
}

export interface HandleWebhookInput {
  readonly payload: string;
  readonly signatureHeader: string;
  readonly configuration: StripeConfiguration;
  readonly store: BillingStore;
  readonly now: Date;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export const handleStripeWebhook = async (input: HandleWebhookInput): Promise<WebhookOutcome> => {
  verifyWebhookSignature({
    payload: input.payload,
    header: input.signatureHeader,
    secret: input.configuration.webhookSecret,
    now: input.now,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.payload);
  } catch (cause) {
    throw new BillingError(
      'invalid_payload',
      'the webhook signature verified but the body is not JSON, which should be impossible; refusing rather than guessing',
      { cause },
    );
  }

  const event = asRecord(parsed);
  const eventId = typeof event.id === 'string' ? event.id : 'unknown';
  const eventType = typeof event.type === 'string' ? event.type : 'unknown';

  if (!isHandled(eventType)) {
    return {
      eventId,
      eventType,
      applied: false,
      reason: `${eventType} is not one of the events this endpoint acts on (${HANDLED_EVENTS.join(', ')})`,
      workspaceId: null,
    };
  }

  const object = asRecord(asRecord(event.data).object);
  const subscription = decodeSubscription(object);
  const metadataWorkspace = asRecord(object.metadata).workspace_id;

  if (typeof metadataWorkspace !== 'string' || metadataWorkspace.length === 0) {
    return {
      eventId,
      eventType,
      applied: false,
      reason:
        'the subscription carries no workspace_id in its metadata, so there is nothing to apply it to. ' +
        'Every subscription this application creates sets that metadata; one without it was not created here. ' +
        'There is deliberately no lookup by customer reference: workspace rows are behind FORCE ROW LEVEL SECURITY keyed on the ' +
        'mneia.workspace_id GUC, and finding a workspace without already knowing its id would mean bypassing that (§11.3).',
      workspaceId: null,
    };
  }

  const workspaceId = metadataWorkspace;

  const current = await input.store.snapshot(workspaceId);
  if (current === null) {
    return {
      eventId,
      eventType,
      applied: false,
      reason: `workspace ${workspaceId} does not exist in this database`,
      workspaceId,
    };
  }

  const status = eventType === 'customer.subscription.deleted' ? 'canceled' : subscription.status;

  // Stripe does not guarantee delivery order, so a delayed `.updated` carrying `active`
  // can arrive after the `.deleted` that cancelled the same subscription. Applying it
  // would silently put a cancelled workspace back on the team plan. A cancellation is
  // terminal for a given subscription: once recorded, only a newer subscription id may
  // move the workspace off canceled.
  if (
    current.billingStatus === 'canceled' &&
    status !== 'canceled' &&
    current.billingCustomerRef !== null &&
    subscription.customerId === current.billingCustomerRef
  ) {
    return {
      eventId,
      eventType,
      applied: false,
      reason: `workspace ${workspaceId} is already canceled for customer ${current.billingCustomerRef}, and ${eventType} carrying "${subscription.status}" would revive it. Stripe does not guarantee delivery order, so a later-arriving earlier event is ignored rather than applied. Read the subscription from Stripe if the real state is in doubt.`,
      workspaceId,
    };
  }

  const next = stateAfterSubscription({
    current,
    subscriptionStatus: status,
    seats: subscription.quantity ?? current.seatsPurchased ?? 1,
    customerRef: subscription.customerId ?? current.billingCustomerRef ?? '',
  });

  await input.store.applyBillingState({ workspaceId, state: next });

  return {
    eventId,
    eventType,
    applied: true,
    reason: `plan ${next.plan}, status ${billingStatusFor(status)}, seats ${next.seatsPurchased ?? 0}`,
    workspaceId,
  };
};
