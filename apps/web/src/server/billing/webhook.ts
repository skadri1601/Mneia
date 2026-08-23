import 'server-only';

import type { BillingStore, BillingSubscriptionRef } from './billing-store.js';
import { type BillingState, billingStatusFor, stateAfterSubscription } from './seats.js';
import {
  BillingError,
  decodeSubscription,
  planForPriceId,
  STRIPE_PRICE_ID_PRO_VAR,
  STRIPE_PRICE_ID_VAR,
  type StripeConfiguration,
  type StripeSubscription,
  verifyWebhookSignature,
} from './stripe.js';

/**
 * The events that move a workspace's billing state.
 *
 * Deliberately only the subscription lifecycle. `checkout.session.completed` adds nothing:
 * a `mode=subscription` session produces `customer.subscription.created` carrying the same
 * workspace metadata and the customer, so acting on both would apply the same state twice
 * from two sources of truth. `invoice.payment_failed` and `invoice.paid` add nothing
 * either: a failed payment moves the subscription to `past_due`, `unpaid` or `incomplete`
 * and a recovered one moves it back to `active`, and each of those transitions arrives here
 * as `customer.subscription.updated`. Entitlement is a function of subscription status
 * (seats.ts), so subscription events are sufficient to drive it.
 */
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
  /**
   * Reads the subscription back from Stripe. Required, not optional: the event body is a
   * snapshot from when the event fired, and applying it blind is what lets a late delivery
   * overwrite newer state. Throwing here is the right outcome — the route answers non-2xx
   * and Stripe redelivers, which is preferable to writing an entitlement we cannot confirm.
   */
  readonly readSubscription: (subscriptionId: string) => Promise<StripeSubscription>;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

/**
 * The billing state corrected for the price the subscription is actually on.
 *
 * What a workspace is entitled to follows from what it pays for, and `stateAfterSubscription`
 * cannot see a price — it grants Team to anything with a live subscription. Correcting it
 * here is what stops a $15 Pro subscription buying the $25 Team allowance, and what stops an
 * unrecognised price buying anything at all.
 *
 * `next.plan === 'team'` is exactly the case where the subscription granted entitlement:
 * `stateAfterSubscription` only reaches `team` for a live subscription on a non-enterprise
 * workspace. Everywhere else — a cancellation dropping to solo, a sticky enterprise — the
 * price is not consulted, so a price we do not recognise can never block a downgrade and
 * leave a lapsed workspace entitled forever.
 */
const pricedState = (
  configuration: StripeConfiguration,
  next: BillingState,
  live: StripeSubscription,
): { readonly state: BillingState } | { readonly refusal: string } => {
  if (next.plan !== 'team') {
    return { state: next };
  }

  const granted = planForPriceId(configuration, live.priceId);
  if (granted === null) {
    return {
      refusal:
        `subscription ${live.id} is on price ${live.priceId ?? '(none on its first item)'}, which this deployment does not recognise, so no plan was granted. ` +
        `${STRIPE_PRICE_ID_VAR} is the Team seat price and ${STRIPE_PRICE_ID_PRO_VAR} the Pro price; one of them must name this price, or the subscription must be moved onto a price that is configured. ` +
        'Nothing is guessed here on purpose: defaulting to team would give away the seated allowance, and defaulting to solo would cut off someone who is paying.',
    };
  }

  return { state: granted === 'team' ? next : { ...next, plan: granted } };
};

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

  // Everything from here reads the subscription as Stripe holds it now rather than as the
  // event described it. Two deliveries of the same event therefore converge on one state
  // instead of replaying an older one, and an event that arrives late applies current
  // truth. The event body is still what names the workspace, because metadata is what it
  // is for and re-reading cannot tell us who an unlabelled subscription belongs to.
  const live = await input.readSubscription(subscription.id);

  const status = eventType === 'customer.subscription.deleted' ? 'canceled' : live.status;

  // Stripe does not guarantee delivery order, so a delayed `.updated` carrying `active`
  // can arrive after the `.deleted` that cancelled the same subscription. Applying it
  // would silently put a cancelled workspace back on the team plan. A cancellation is
  // terminal for a given subscription: once recorded, only a newer subscription id may
  // move the workspace off canceled.
  if (
    current.billingStatus === 'canceled' &&
    status !== 'canceled' &&
    current.billingCustomerRef !== null &&
    live.customerId === current.billingCustomerRef
  ) {
    return {
      eventId,
      eventType,
      applied: false,
      reason: `workspace ${workspaceId} is already canceled for customer ${current.billingCustomerRef}, and ${eventType} carrying "${live.status}" would revive it. Stripe does not guarantee delivery order, so a later-arriving earlier event is ignored rather than applied. Read the subscription from Stripe if the real state is in doubt.`,
      workspaceId,
    };
  }

  const next = stateAfterSubscription({
    current,
    subscriptionStatus: status,
    seats: live.quantity ?? current.seatsPurchased ?? 1,
    customerRef: live.customerId ?? current.billingCustomerRef ?? '',
  });

  const priced = pricedState(input.configuration, next, live);
  if ('refusal' in priced) {
    return { eventId, eventType, applied: false, reason: priced.refusal, workspaceId };
  }

  const state = priced.state;

  // The subscription's address, recorded at the only moment it is reliably in hand. This
  // is the live object read back from Stripe a few lines above, not the event body, so it
  // is current rather than whatever was true when the event fired. Without it
  // StripeClient.updateSeats has nothing to address and a Team workspace that gains a
  // member keeps billing at its old quantity (migration 0036).
  //
  // A cancellation clears it deliberately: a cancelled subscription's item must never be
  // the target of a later quantity change.
  const address: BillingSubscriptionRef =
    state.billingStatus === 'canceled'
      ? { subscriptionRef: null, itemRef: null }
      : { subscriptionRef: live.id, itemRef: live.itemId };

  await input.store.applyBillingState({ workspaceId, state, subscription: address });

  return {
    eventId,
    eventType,
    applied: true,
    reason: `plan ${state.plan}, status ${billingStatusFor(status)}, seats ${state.seatsPurchased ?? 0}`,
    workspaceId,
  };
};
