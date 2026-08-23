import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ApiAuthError, resolveBearerIdentity } from '../../../server/api-auth.js';
import { clientFromUserAgent, createRemoteMcpSession } from '../../../server/mcp/runtime.js';
import { deviceStore } from '../../../server/device-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// RFC 9728. An MCP client that gets a 401 reads this to find out where to authenticate rather
// than guessing, and the WWW-Authenticate header below points at it. We are the resource server;
// we do not yet run an authorization server, so this advertises the token endpoint a caller
// already has — `mneia login`, the RFC 8628 device grant at /api/device/code.
// Must match what the metadata document itself advertises, and for the same reason: behind Caddy
// the request URL is the container's internal address, so a WWW-Authenticate built from it points
// a client at somewhere it cannot reach.
const APP_ORIGIN = (process.env.MNEIA_APP_ORIGIN ?? 'https://app.mneia.dev').replace(/\/+$/, '');

const resourceMetadataUrl = (): string => `${APP_ORIGIN}/.well-known/oauth-protected-resource`;

const unauthorized = (message: string): Response =>
  Response.json(
    { error: 'invalid_token', message },
    {
      status: 401,
      headers: {
        'www-authenticate': `Bearer error="invalid_token", error_description="${message.replace(/"/g, "'")}", resource_metadata="${resourceMetadataUrl()}"`,
      },
    },
  );

/**
 * Remote MCP over Streamable HTTP.
 *
 * This is the transport every web client needs — claude.ai, ChatGPT in developer mode, Grok, and
 * Gemini Enterprise — because none of them can spawn a local process the way a CLI or IDE does.
 * Gemini Enterprise accepts Streamable HTTP and explicitly refuses SSE, and SSE is deprecated as
 * of the 2026-07-28 revision, so this is the only transport worth serving.
 *
 * Stateless on purpose: no session id is issued and no per-connection state is kept, so a client
 * may be answered by any container and a deploy cannot strand a session. It is also where the
 * protocol itself is going — 2026-07-28 removes Mcp-Session-Id and the initialize handshake
 * outright. The cost is that server-initiated messages have nowhere to go, which nothing we ship
 * uses: all eleven tools are request/response.
 */
export async function POST(request: Request): Promise<Response> {
  let identity: Awaited<ReturnType<typeof resolveBearerIdentity>>;
  try {
    identity = await resolveBearerIdentity(request.headers.get('authorization'), (tokenHash) =>
      deviceStore.identify(tokenHash),
    );
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return unauthorized(error.message);
    }
    throw error;
  }

  const session = createRemoteMcpSession(
    identity,
    clientFromUserAgent(request.headers.get('user-agent')),
  );
  // Omitting sessionIdGenerator is what puts the transport in stateless mode. Supplying one would
  // make it issue and then demand Mcp-Session-Id, which needs shared storage we deliberately do
  // not have. It is omitted rather than passed as undefined because exactOptionalPropertyTypes
  // makes those two different things to the compiler.
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Answer with a single JSON body rather than opening an SSE stream. Nothing we serve streams,
    // and a plain response survives Caddy's compression and Cloudflare's idle timeout without
    // needing keepalives.
    enableJsonResponse: true,
  });

  try {
    await session.server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    // Both are per-request in stateless mode. Leaving them attached leaks a server object and,
    // with it, the write-session resolver holding a reference to the scoped store.
    await session.shutdown().catch(() => undefined);
  }
}

// Streamable HTTP uses GET to open a server-to-client notification stream. Stateless mode has no
// connection to attach one to, and the spec's prescribed answer is 405 rather than an error body
// a client would have to interpret.
export function GET(): Response {
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}

export function DELETE(): Response {
  return new Response(null, { status: 405, headers: { allow: 'POST' } });
}
