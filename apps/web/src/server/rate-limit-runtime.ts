import 'server-only';

import { database } from './database.js';
import { type RateLimitConfig, readRateLimitConfig } from './rate-limit.js';
import { PostgresRateLimitStore } from './store/postgres-rate-limit-store.js';
import type { RateLimitStore } from './store/rate-limit-store.js';

let store: RateLimitStore | undefined;
let config: RateLimitConfig | undefined;

export const rateLimitStore = (): RateLimitStore => {
  store ??= new PostgresRateLimitStore(database);
  return store;
};

export const rateLimitConfig = (): RateLimitConfig => {
  config ??= readRateLimitConfig(process.env);
  return config;
};
