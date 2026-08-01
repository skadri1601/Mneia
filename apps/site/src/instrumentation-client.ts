import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
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
