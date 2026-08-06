import 'server-only';

import { database } from './database.js';
import { PostgresDeviceStore } from './store/postgres-device-store.js';

export const deviceStore = new PostgresDeviceStore(database);

export const DEVICE_CODE_LIFETIME_SECONDS = 900;
export const DEVICE_POLL_INTERVAL_SECONDS = 5;

export const appOrigin = (): string =>
  (process.env.MNEIA_APP_ORIGIN ?? 'https://app.mneia.dev').replace(/\/+$/, '');

export const verificationUri = (): string => `${appOrigin()}/device`;

export const verificationUriComplete = (userCode: string): string =>
  `${verificationUri()}?user_code=${encodeURIComponent(userCode)}`;
