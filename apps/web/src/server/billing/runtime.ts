import 'server-only';

import type { PostgresConnectionSource } from '@mneia/core';
import { database } from '../database.js';
import { type BillingStore, PostgresBillingStore } from './billing-store.js';
import { StripeSeatSync } from './checkout.js';
import { checkpointQuota, type QuotaDecision, type QuotaRequest } from './quota.js';
import { PostgresQuotaStore, type QuotaStore } from './quota-store.js';
import { requireStripeConfiguration, StripeClient } from './stripe.js';

const FALLBACK_APP_ORIGIN = 'https://app.mneia.dev';

const validOrigin = (value: string): string | null => {
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:' && url.hostname === 'localhost';
    if (
      (url.protocol !== 'https:' && !localHttp) ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};

export const billingOrigin = (
  env: Readonly<Record<string, string | undefined>> = process.env,
): string => validOrigin(env.MNEIA_APP_ORIGIN?.trim() ?? '') ?? FALLBACK_APP_ORIGIN;

export interface BillingRuntime {
  readonly store: BillingStore;
  readonly stripe: StripeClient;
  readonly origin: string;
  /**
   * Pushes a workspace's seat count to its Stripe subscription.
   *
   * Built from the same store and client as the rest of the runtime rather than
   * constructing its own, so a request holds one StripeClient and one connection source.
   * Exposed here because StripeSeatSync was reachable from nowhere: `updateSeats` has
   * existed since MNE-141 and nothing could call it, which is the seat-sync revenue leak.
   */
  readonly seatSync: StripeSeatSync;
}

export const createBillingRuntime = (
  source: PostgresConnectionSource,
  env: Readonly<Record<string, string | undefined>> = process.env,
): BillingRuntime => {
  const store = createBillingStore(source);
  const stripe = new StripeClient({ configuration: requireStripeConfiguration(env) });

  return {
    store,
    stripe,
    origin: billingOrigin(env),
    seatSync: new StripeSeatSync(store, stripe),
  };
};

export const createBillingStore = (source: PostgresConnectionSource): BillingStore =>
  new PostgresBillingStore(source);

export const billingStore = (): BillingStore => createBillingStore(database);

export const billingRuntime = (): BillingRuntime => createBillingRuntime(database);

export const createQuotaStore = (source: PostgresConnectionSource): QuotaStore =>
  new PostgresQuotaStore(source);

export const quotaStore = (): QuotaStore => createQuotaStore(database);

export const checkpointQuotaFor = async (
  workspaceId: string,
  now: Date,
  request: QuotaRequest,
  store: QuotaStore = quotaStore(),
): Promise<QuotaDecision> => {
  const state = await store.quotaFor(workspaceId, now);
  // A workspace row that does not exist cannot be metered. The caller is already
  // authenticated against it, so this is a torn state rather than an unpaid one, and
  // refusing the checkpoint would lose work over a bookkeeping gap.
  return state === null ? { allowed: true, source: 'allowance' } : checkpointQuota(state, request);
};
