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

test('protects matched app routes', async () => {
  const protect = vi.fn().mockResolvedValue(undefined);
  const handler = middleware as unknown as (
    auth: { protect: () => Promise<void> },
    request: { nextUrl: { pathname: string } },
  ) => Promise<void>;

  await handler({ protect }, { nextUrl: { pathname: '/workspace' } });

  expect(protect).toHaveBeenCalledOnce();
});

test('leaves local sign-in and sign-up routes public', async () => {
  const protect = vi.fn().mockResolvedValue(undefined);
  const handler = middleware as unknown as (
    auth: { protect: () => Promise<void> },
    request: { nextUrl: { pathname: string } },
  ) => Promise<void>;

  await handler({ protect }, { nextUrl: { pathname: '/sign-in' } });
  await handler({ protect }, { nextUrl: { pathname: '/sign-up/verify' } });

  expect(protect).not.toHaveBeenCalled();
});
