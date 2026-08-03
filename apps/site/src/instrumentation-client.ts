import * as Sentry from '@sentry/nextjs';
import { initHoneybadger } from '../honeybadger.config';
import { RUNTIME_ENVIRONMENT } from './lib/environment';

initHoneybadger(process.env.NEXT_PUBLIC_HONEYBADGER_API_KEY, RUNTIME_ENVIRONMENT);

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
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
