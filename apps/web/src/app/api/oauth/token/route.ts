import { oauthStore } from '../../../../server/oauth-runtime.js';
import { hashSecret, OAuthError } from '../../../../server/store/postgres-oauth-store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  invalid_client: 401,
  invalid_grant: 400,
  invalid_request: 400,
  invalid_redirect_uri: 400,
  unsupported_grant_type: 400,
  server_error: 500,
};

const fail = (code: string, description: string): Response =>
  Response.json(
    { error: code, error_description: description },
    {
      status: STATUS_BY_CODE[code] ?? 400,
      // A token endpoint answer must never be cached — it carries a credential.
      headers: { 'cache-control': 'no-store', pragma: 'no-cache' },
    },
  );

/**
 * RFC 6749 §4.1.3 token endpoint, OAuth 2.1 rules.
 *
 * The request is form-encoded, not JSON — that is the specification, and a client that sends JSON
 * here is a client that will fail against every other authorization server too, so it is refused
 * rather than accommodated.
 *
 * The code exchange and the access token are one database transaction (see redeemCode), so a code
 * is never spent without a token coming back.
 */
export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return fail(
      'invalid_request',
      `expected content-type application/x-www-form-urlencoded; received "${contentType || 'nothing'}"`,
    );
  }

  const form = new URLSearchParams(await request.text());
  const grantType = form.get('grant_type') ?? '';
  if (grantType !== 'authorization_code') {
    return fail(
      'unsupported_grant_type',
      `expected grant_type=authorization_code; received "${grantType || 'nothing'}". Refresh tokens and client credentials are not issued.`,
    );
  }

  const code = form.get('code') ?? '';
  const clientId = form.get('client_id') ?? '';
  const codeVerifier = form.get('code_verifier') ?? '';
  const redirectUri = form.get('redirect_uri') ?? '';

  for (const [name, value] of [
    ['code', code],
    ['client_id', clientId],
    ['code_verifier', codeVerifier],
    ['redirect_uri', redirectUri],
  ] as const) {
    if (value.length === 0) {
      return fail('invalid_request', `expected ${name} in the form body; it was missing or empty`);
    }
  }

  const client = await oauthStore.findClient(clientId);
  if (client === null) {
    return fail('invalid_client', `no client is registered with client_id ${clientId}`);
  }

  // A confidential client must prove it holds the secret. A public client proves itself with the
  // PKCE verifier instead, which redeemCode checks — so there is no unauthenticated path here.
  if (client.hasSecret) {
    const presented = form.get('client_secret') ?? '';
    if (presented.length === 0) {
      return fail(
        'invalid_client',
        'this client registered with token_endpoint_auth_method=client_secret_post, so client_secret is required',
      );
    }
    const stored = await oauthStore.clientSecretHash(clientId);
    if (stored === null || hashSecret(presented) !== stored) {
      return fail(
        'invalid_client',
        'the client_secret presented does not match the one registered',
      );
    }
  }

  try {
    const exchanged = await oauthStore.redeemCode({
      code,
      clientId,
      codeVerifier,
      redirectUri,
    });

    return Response.json(
      {
        access_token: exchanged.accessToken,
        token_type: 'Bearer',
        scope: exchanged.scope,
      },
      { headers: { 'cache-control': 'no-store', pragma: 'no-cache' } },
    );
  } catch (error) {
    if (error instanceof OAuthError) {
      return fail(error.code, error.message);
    }
    return fail(
      'server_error',
      'the authorization code could not be exchanged. Nothing was issued — start the authorization again.',
    );
  }
}
