// The package entry point resolves to the Node build, which requires `domain` — a module workerd
// does not provide even under nodejs_compat. The browser build is fetch-based and runs unchanged on
// Workers, in Node, and in the browser, so every runtime here imports it explicitly.
import honeybadger from '@honeybadger-io/js/dist/browser/honeybadger.js';

export { honeybadger };

export function initHoneybadger(apiKey: string | undefined, environment: string): void {
  honeybadger.configure({
    apiKey: apiKey ?? '',
    environment,
    maxBreadcrumbs: 100,
    maxObjectDepth: 10,
    ...(apiKey ? {} : { reportData: false }),
  });
}

export function toNoticeable(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
