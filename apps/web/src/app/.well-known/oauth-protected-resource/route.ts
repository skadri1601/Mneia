export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * RFC 9728 protected resource metadata.
 *
 * MCP clients probe this after a 401 to discover how to authenticate, and the 2025-06-18 revision
 * made it the prescribed discovery path. Publishing it costs nothing and turns an opaque 401 into
 * something a client can act on.
 *
 * We are the resource server only. There is no authorization server here yet, so
 * `authorization_servers` is deliberately absent rather than pointing somewhere that would fail
 * discovery — a client that reads this learns the resource identifier, the scheme, and where a
 * human goes to get a token. Bearer tokens are minted by `mneia login` through the RFC 8628 device
 * grant at /api/device/code, which is a human-in-the-loop flow rather than an OAuth AS.
 *
 * Building a real authorization server is what directory publication requires — the Anthropic
 * Connectors Directory and the OpenAI Plugin Directory both mandate OAuth 2.1, and the latter
 * dynamic client registration. Connecting a server by hand does not: claude.ai accepts request
 * headers and ChatGPT developer mode accepts an API key.
 */
export function GET(request: Request): Response {
  const origin = new URL(request.url).origin;

  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      bearer_methods_supported: ['header'],
      resource_name: 'Mneia',
      resource_documentation: 'https://mneia.dev/docs/mcp',
    },
    {
      headers: {
        // Discovery metadata is stable and fetched on every connection attempt.
        'cache-control': 'public, max-age=3600',
      },
    },
  );
}
