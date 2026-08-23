export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Behind Caddy the request URL is the container's internal address, so every URL in this document
// has to come from configuration. Publishing an unreachable authorization_endpoint is worse than
// publishing nothing: a client discovers it, redirects a human to it, and the flow dies there.
const APP_ORIGIN = (process.env.MNEIA_APP_ORIGIN ?? 'https://app.mneia.dev').replace(/\/+$/, '');

/**
 * RFC 8414 authorization server metadata.
 *
 * This is what makes the server connectable from a directory listing rather than by hand. The
 * Anthropic Connectors Directory and the OpenAI Plugin Directory both require OAuth 2.1, and the
 * latter requires dynamic client registration, which is why `registration_endpoint` is advertised.
 *
 * `S256` is the only code challenge method offered. OAuth 2.1 requires PKCE, and `plain` provides
 * no protection against an intercepted authorization code — the entire threat PKCE exists for — so
 * offering it would only invite a client to pick it.
 */
export function GET(): Response {
  return Response.json(
    {
      issuer: APP_ORIGIN,
      authorization_endpoint: `${APP_ORIGIN}/oauth/authorize`,
      token_endpoint: `${APP_ORIGIN}/api/oauth/token`,
      registration_endpoint: `${APP_ORIGIN}/api/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      // RFC 8707. The 2025-06-18 revision made audience validation mandatory, so a client must be
      // able to say which resource server it wants a token for.
      resource_indicators_supported: true,
      scopes_supported: ['mcp'],
      service_documentation: 'https://mneia.dev/docs/mcp',
    },
    { headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
