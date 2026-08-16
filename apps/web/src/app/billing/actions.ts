'use server';

import { redirect } from 'next/navigation';
import {
  checkoutRequestFor,
  portalRequestFor,
  stripeHostedRedirectUrl,
} from '../../server/billing/checkout.js';
import { billingRuntime } from '../../server/billing/runtime.js';
import { getCurrentAccount } from '../../server/current-account.js';

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
