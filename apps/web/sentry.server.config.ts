import * as Sentry from '@sentry/nextjs';
import {
  NO_USER_CONTENT,
  observeSentryDelivery,
  scrubRequestData,
} from './src/server/error-reporting.js';

const client = Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  attachStacktrace: true,
  tracesSampleRate: 0,
  maxBreadcrumbs: 50,
  dataCollection: NO_USER_CONTENT,
  beforeSend: scrubRequestData,
});

if (client !== undefined) {
  observeSentryDelivery(client);
}
