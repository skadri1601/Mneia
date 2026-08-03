import * as Sentry from '@sentry/nextjs';
import { honeybadger, initHoneybadger, toNoticeable } from '../honeybadger.config';
import { RUNTIME_ENVIRONMENT } from './lib/environment';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }

  initHoneybadger(process.env.HONEYBADGER_API_KEY, RUNTIME_ENVIRONMENT);
}

export const onRequestError = (...args: Parameters<typeof Sentry.captureRequestError>) => {
  const [error, request, context] = args;

  honeybadger.notify(toNoticeable(error), {
    context: { ...context, path: request.path, method: request.method },
  });

  return Sentry.captureRequestError(...args);
};
