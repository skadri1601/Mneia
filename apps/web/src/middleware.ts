import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  '/api/device/code',
  '/api/device/token',
  '/api/me',
  '/api/v1(.*)',
  // The MCP endpoint authenticates with a bearer token it verifies itself, the same way /api/v1
  // does. Without this Clerk answers an unauthenticated MCP client with a 302 to /sign-in, which
  // a client reports as a malformed response rather than as an auth failure it could act on.
  '/api/mcp',
  // RFC 9728 discovery has to be readable before anyone is authenticated — that is its whole job.
  '/.well-known/(.*)',
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect({
      unauthenticatedUrl: new URL('/sign-in', request.url).toString(),
    });
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/__clerk/:path*',
    '/(api|trpc)(.*)',
  ],
};
