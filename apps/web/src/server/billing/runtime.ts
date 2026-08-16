import 'server-only';

import type { PostgresConnectionSource } from '@mneia/core';
import { database } from '../database.js';
import { type BillingStore, PostgresBillingStore } from './billing-store.js';
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

export const billingOrigin = (env: NodeJS.ProcessEnv = process.env): string =>
  validOrigin(env.MNEIA_APP_ORIGIN?.trim() ?? '') ?? FALLBACK_APP_ORIGIN;

export interface BillingRuntime {
  readonly store: BillingStore;
  readonly stripe: StripeClient;
  readonly origin: string;
}

export const createBillingRuntime = (
  source: PostgresConnectionSource,
  env: NodeJS.ProcessEnv = process.env,
): BillingRuntime => ({
  store: createBillingStore(source),
  stripe: new StripeClient({ configuration: requireStripeConfiguration(env) }),
  origin: billingOrigin(env),
});

export const createBillingStore = (source: PostgresConnectionSource): BillingStore =>
  new PostgresBillingStore(source);

export const billingStore = (): BillingStore => createBillingStore(database);

export const billingRuntime = (): BillingRuntime => createBillingRuntime(database);
