'use server';

import { redirect } from 'next/navigation';
import {
  BillingControlError,
  checkoutRequestFor,
  portalRequestFor,
  stripeHostedRedirectUrl,
} from '../../server/billing/checkout.js';
import { billingRuntime } from '../../server/billing/runtime.js';
import { seatsCommitted } from '../../server/billing/seats.js';
import { getCurrentAccount } from '../../server/current-account.js';
import { seats } from '../../server/membership-runtime.js';

const attemptToken = (formData: FormData): string => {
  const value = formData.get('attemptToken');
  return typeof value === 'string' ? value : '';
};

export async function checkoutAction(formData: FormData): Promise<void> {
  const account = await getCurrentAccount();
  const runtime = billingRuntime();
  const snapshot = await runtime.store.snapshot(account.workspace.id);
  if (snapshot === null) {
    throw new Error('expected the authenticated workspace to have a billing snapshot; found none');
  }

  const request = checkoutRequestFor({
    account: { workspaceId: account.workspace.id, role: account.membership.role },
    snapshot,
    attemptToken: attemptToken(formData),
    origin: runtime.origin,
  });
  const session = await runtime.stripe.createCheckoutSession(request);
  redirect(stripeHostedRedirectUrl(session.url));
}

export async function portalAction(formData: FormData): Promise<void> {
  const account = await getCurrentAccount();
  const runtime = billingRuntime();
  const snapshot = await runtime.store.snapshot(account.workspace.id);
  if (snapshot === null) {
    throw new Error('expected the authenticated workspace to have a billing snapshot; found none');
  }

  const request = portalRequestFor({
    account: { workspaceId: account.workspace.id, role: account.membership.role },
    snapshot,
    attemptToken: attemptToken(formData),
    origin: runtime.origin,
  });
  const session = await runtime.stripe.createPortalSession(request);
  redirect(stripeHostedRedirectUrl(session.url));
}

/**
 * How many seats the lead is asking to pay for.
 *
 * Validated here because a form field is a trust boundary: the number input's `min` is a
 * hint to a browser, not a guarantee to a server, and this value becomes a Stripe quantity
 * that moves real money.
 */
const seatsFrom = (formData: FormData): number => {
  const raw = formData.get('seats');
  const seats = typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isInteger(seats) || seats < 1) {
    throw new BillingControlError(
      `expected the seat count to be a whole number of at least 1; received "${String(raw)}" — pick a seat count on the billing page and submit again`,
    );
  }
  return seats;
};

/**
 * A lead deliberately buying or releasing seats.
 *
 * The only call site allowed to raise a customer's bill, which is why it goes through
 * `purchaseSeats` (intent `purchase`) rather than `syncSeats`. A membership event reaches
 * seat sync from the team surface with intent `membership`, where it may lower the bill and
 * never raise it — nobody is charged for a seat they did not click for.
 *
 * No attempt token, unlike checkout and portal. `updateSeats` sends an absolute quantity
 * rather than a delta, so a double-submitted form converges on the same subscription state;
 * an idempotency key would be ceremony over something already idempotent, and a retry loop
 * on top of it would be worse.
 */
export async function purchaseSeatsAction(formData: FormData): Promise<void> {
  const account = await getCurrentAccount();
  if (account.membership.role !== 'lead') {
    throw new BillingControlError(
      'expected a workspace lead to be buying seats; this actor is a member — only a lead can change what this workspace is billed',
    );
  }

  const runtime = billingRuntime();
  const snapshot = await runtime.store.snapshot(account.workspace.id);
  if (snapshot === null) {
    throw new Error('expected the authenticated workspace to have a billing snapshot; found none');
  }

  const seatCount = seatsFrom(formData);

  // Re-checked against the server's own count, never the form's, and against members plus
  // live invitations rather than members alone. A seat promised to a named person is spent
  // even before they accept, so shrinking to the accepted count lets the next acceptance
  // push memberCount past seatsPurchased and leave every member refused with
  // `seats_exceeded` (quota.ts). The invitation and removal paths already reckon with
  // `seatsCommitted`; this one did not.
  const position = await seats().seatPosition({
    workspaceId: account.workspace.id,
    actorId: account.actor.id,
  });
  if (position === null) {
    throw new Error('expected the authenticated workspace to have a seat position; found none');
  }

  const floor = seatsCommitted(position);
  if (seatCount < floor) {
    const waiting =
      position.pendingInvitations === 0
        ? ''
        : ` and ${position.pendingInvitations} invitation${position.pendingInvitations === 1 ? '' : 's'} still waiting to be accepted`;
    throw new BillingControlError(
      `expected at least ${floor} seats, one for each of the ${position.memberCount} accepted member${position.memberCount === 1 ? '' : 's'}${waiting}; received ${seatCount} — remove members, or revoke an invitation, if you mean to pay for fewer seats`,
    );
  }

  const outcome = await runtime.seatSync.purchaseSeats({
    workspaceId: account.workspace.id,
    seats: seatCount,
  });

  redirect(`/billing?seats=${outcome.synced ? 'updated' : 'unchanged'}`);
}
