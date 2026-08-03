import { expect, test, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher:
    () =>
    (request: { nextUrl: { pathname: string } }): boolean =>
      request.nextUrl.pathname.startsWith('/sign-in') ||
      request.nextUrl.pathname.startsWith('/sign-up'),
}));

import middleware from './middleware.js';

type Handler = (
  auth: { protect: (options?: { unauthenticatedUrl?: string }) => Promise<void> },
  request: { nextUrl: { pathname: string }; url: string },
) => Promise<void>;

test('protects matched app routes', async () => {
  const protect = vi.fn().mockResolvedValue(undefined);
  const handler = middleware as unknown as Handler;

  await handler(
    { protect },
    { nextUrl: { pathname: '/workspace' }, url: 'https://app.mneia.dev/workspace' },
  );

  expect(protect).toHaveBeenCalledOnce();
});

test('sends a signed-out visitor to sign-in rather than letting Clerk rewrite a 404', async () => {
  const protect = vi.fn().mockResolvedValue(undefined);
  const handler = middleware as unknown as Handler;

  await handler(
    { protect },
    { nextUrl: { pathname: '/projects' }, url: 'https://app.mneia.dev/projects' },
  );

  expect(protect).toHaveBeenCalledWith({
    unauthenticatedUrl: 'https://app.mneia.dev/sign-in',
  });
});

test('leaves local sign-in and sign-up routes public', async () => {
  const protect = vi.fn().mockResolvedValue(undefined);
  const handler = middleware as unknown as (
    auth: { protect: () => Promise<void> },
    request: { nextUrl: { pathname: string } },
  ) => Promise<void>;

  await handler(
    { protect },
    { nextUrl: { pathname: '/sign-in' }, url: 'https://app.mneia.dev/sign-in' },
  );
  await handler(
    { protect },
    { nextUrl: { pathname: '/sign-up/verify' }, url: 'https://app.mneia.dev/sign-up/verify' },
  );

  expect(protect).not.toHaveBeenCalled();
});
