import * as Sentry from '@sentry/nextjs';
import { RUNTIME_ENVIRONMENT } from './lib/environment';
import { scrubSensitiveHeaders } from './lib/scrub';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: RUNTIME_ENVIRONMENT,
  attachStacktrace: true,
  maxBreadcrumbs: 100,
  dataCollection: {
    userInfo: true,
    cookies: true,
    httpHeaders: { request: true, response: true },
    urlQueryParams: true,
    stackFrameVariables: true,
    frameContextLines: 10,
  },
  integrations: [Sentry.extraErrorDataIntegration({ depth: 10 })],
  beforeSend: scrubSensitiveHeaders,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
