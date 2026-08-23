import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { oauthStore } from '../../../../server/oauth-runtime.js';
import { hashSecret } from '../../../../server/store/postgres-oauth-store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// RFC 7591 lets a client send far more than this. We accept the fields the flow actually uses and
// ignore the rest rather than storing metadata nothing reads — an unused column is a liability in
// a table that anyone on the internet can write to.
const RegistrationSchema = z.object({
  client_name: z.string().trim().min(1).max(200).optional(),
  redirect_uris: z.array(z.string().url()).min(1).max(10),
  token_endpoint_auth_method: z.enum(['none', 'client_secret_post']).optional(),
  application_type: z.enum(['native', 'web']).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
});

const error = (code: string, description: string, status: number): Response =>
  Response.json({ error: code, error_description: description }, { status });

/**
 * RFC 7591 dynamic client registration.
 *
 * **This endpoint is unauthenticated, and that is what the specification requires.** Any client on
 * the internet may register. That is deliberate — it is how a directory-listed connector obtains
 * credentials without a human ever visiting this site — but it does mean the table is writable by
 * strangers, so registration grants nothing on its own: a client with no authorization code can
 * read no data at all. Access only exists once a human has approved a code in their own workspace.
 *
 * The 2026-07-28 revision formally deprecates DCR in favour of Client ID Metadata Documents and
 * keeps it as the fallback. It is the fallback that directories require today.
 */
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return error('invalid_client_metadata', 'expected a JSON body; it could not be parsed', 400);
  }

  const parsed = RegistrationSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return error(
      'invalid_client_metadata',
      first === undefined
        ? 'the registration request did not match the expected shape'
        : `${first.path.join('.')}: ${first.message}`,
      400,
    );
  }

  // Every redirect URI must be https, or localhost for a native client developing against it.
  // http to a public host would leak the authorization code in transit.
  for (const uri of parsed.data.redirect_uris) {
    const url = new URL(uri);
    const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !isLoopback) {
      return error(
        'invalid_redirect_uri',
        `expected every redirect_uri to use https, or http on localhost; received ${uri}`,
        400,
      );
    }
  }

  const authMethod = parsed.data.token_endpoint_auth_method ?? 'none';
  // A public client proves itself with the PKCE verifier and holds no secret. Only a confidential
  // client gets one, and it is returned exactly once — we store the hash and cannot show it again.
  const clientSecret = authMethod === 'none' ? null : randomUUID().replace(/-/g, '');

  try {
    const registered = await oauthStore.registerClient({
      clientName: parsed.data.client_name ?? 'Unnamed MCP client',
      redirectUris: parsed.data.redirect_uris,
      tokenEndpointAuthMethod: authMethod,
      applicationType: parsed.data.application_type ?? 'native',
      clientSecretHash: clientSecret === null ? null : hashSecret(clientSecret),
    });

    return Response.json(
      {
        client_id: registered.clientId,
        ...(clientSecret === null ? {} : { client_secret: clientSecret }),
        client_name: registered.clientName,
        redirect_uris: registered.redirectUris,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: registered.tokenEndpointAuthMethod,
        application_type: registered.applicationType,
      },
      { status: 201 },
    );
  } catch {
    return error(
      'server_error',
      'the client could not be registered. Nothing was stored — retry once, and report it if it persists.',
      500,
    );
  }
}
