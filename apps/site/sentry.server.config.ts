import * as Sentry from '@sentry/nextjs';
import { RUNTIME_ENVIRONMENT } from './src/lib/environment';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: RUNTIME_ENVIRONMENT,
  attachStacktrace: true,
  maxBreadcrumbs: 100,
  dataCollection: {
    userInfo: true,
    cookies: true,
    httpHeaders: { request: true, response: true },
    httpBodies: ['incomingRequest', 'outgoingRequest', 'incomingResponse', 'outgoingResponse'],
    urlQueryParams: true,
    stackFrameVariables: true,
    frameContextLines: 10,
  },
  integrations: [Sentry.extraErrorDataIntegration({ depth: 10 })],
});
