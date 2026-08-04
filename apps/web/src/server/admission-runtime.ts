import 'server-only';

import { sendAccessGranted } from './access-email.js';
import { database } from './database.js';
import { PostgresAdmissionStore } from './store/postgres-admission-store.js';

export const admissionStore = new PostgresAdmissionStore(database);

export class AccessEmailConfigurationError extends Error {
  constructor(variable: string) {
    super(
      `${variable} must be set before the access email can be sent; approve is refused rather than approving someone we cannot reach`,
    );
    this.name = 'AccessEmailConfigurationError';
  }
}

const required = (variable: string): string => {
  const value = process.env[variable];
  if (value === undefined || value.trim().length === 0) {
    throw new AccessEmailConfigurationError(variable);
  }
  return value.trim();
};

export const appOrigin = (): string =>
  (process.env.MNEIA_APP_ORIGIN ?? 'https://app.mneia.dev').replace(/\/+$/, '');

export const welcomeUrl = (): string => `${appOrigin()}/welcome`;

export const deliverAccessEmail = async (input: {
  readonly to: string;
  readonly idempotencyKey: string;
  readonly subject: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
}) =>
  sendAccessGranted({
    to: input.to,
    from: required('WAITLIST_FROM'),
    apiKey: required('RESEND_API_KEY'),
    idempotencyKey: input.idempotencyKey,
    email: { subject: input.subject, text: input.text, headers: input.headers },
  });
