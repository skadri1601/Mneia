import type { DocPage } from './types';

export const OAUTH: DocPage = {
  slug: 'oauth',
  name: 'OAuth for remote MCP',
  title: 'OAuth for remote MCP',
  description:
    'How a remote MCP client authenticates against Mneia: the OAuth 2.1 authorization code flow with PKCE, dynamic client registration, the discovery documents at .well-known, the consent screen, and how the resulting token is scoped and revoked.',
  eyebrow: 'Reference',
  heading: 'How a hosted client gets a token.',
  lead: 'A CLI or an IDE can spawn a local process and read a credentials file. A web client cannot. Mneia runs an OAuth 2.1 authorization server so a remote MCP client can be connected the way its own directory expects, without anyone pasting a token into a text box.',
  minutes: 11,
  sections: [
    {
      id: 'when',
      heading: 'When you need this',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Most people never touch any of this. If you run an MCP client on your own machine - Claude Code, Cursor, Codex, VS Code, Windsurf - the answer is `mneia login`, which runs a device flow and writes a token to `~/.mneia/credentials`. The local MCP server reads that file. Nothing here applies.',
            'OAuth is for the case that cannot work: a client running on somebody else’s infrastructure, which cannot start a process on your laptop and cannot read your home directory. It speaks to Mneia over HTTP instead, at `/api/mcp`, and it needs a way to obtain a bearer token that does not involve you copying one out of a terminal.',
          ],
        },
        {
          kind: 'table',
          head: ['You are connecting', 'Use'],
          rows: [
            [
              'A client on your own machine',
              '`mneia login`, then `mneia mcp install`. The device flow, not OAuth',
            ],
            [
              'A CI job or an ephemeral runner',
              '`MNEIA_TOKEN` in the environment. No browser is involved at all',
            ],
            [
              'A hosted client, or one listed in a connector directory',
              'The OAuth flow on this page. It is what those directories require',
            ],
          ],
        },
        {
          kind: 'note',
          text: 'Both routes end in the same place: a row in `api_token`, scoped to one workspace and one actor, revocable from the tokens page. OAuth is a different way of getting one, not a different kind of credential.',
        },
      ],
    },
    {
      id: 'discovery',
      heading: 'Discovery',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A client that gets a `401` from `/api/mcp` is not left guessing. The response carries a `WWW-Authenticate` header naming the protected-resource metadata document, and that document names the authorization server. Two fetches and the client knows every endpoint it needs.',
          ],
        },
        {
          kind: 'table',
          head: ['Document', 'Specification', 'What it answers'],
          rows: [
            [
              '`/.well-known/oauth-protected-resource`',
              'RFC 9728',
              'What resource this is, which authorization servers issue tokens for it, and how a bearer token should be presented',
            ],
            [
              '`/.well-known/oauth-authorization-server`',
              'RFC 8414',
              'Where the authorize, token, and registration endpoints are, and what this server supports',
            ],
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: [
            '$ curl -s https://app.mneia.dev/.well-known/oauth-authorization-server',
            '{',
            '  "issuer": "https://app.mneia.dev",',
            '  "authorization_endpoint": "https://app.mneia.dev/oauth/authorize",',
            '  "token_endpoint": "https://app.mneia.dev/api/oauth/token",',
            '  "registration_endpoint": "https://app.mneia.dev/api/oauth/register",',
            '  "response_types_supported": ["code"],',
            '  "grant_types_supported": ["authorization_code"],',
            '  "code_challenge_methods_supported": ["S256"],',
            '  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"],',
            '  "resource_indicators_supported": true,',
            '  "scopes_supported": ["mcp"]',
            '}',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`S256` is the only code challenge method offered, and that is deliberate rather than incomplete. OAuth 2.1 requires PKCE, and `plain` gives no protection against the intercepted authorization code that PKCE exists to defend against - offering it would only invite a client to choose it.',
          ],
        },
        {
          kind: 'note',
          text: 'Every URL in both documents comes from configuration rather than from the incoming request. Behind a reverse proxy the request URL is the container’s internal address, and a client that reads an unreachable `authorization_endpoint` fails at exactly the moment it is trying to connect. This shipped wrong once, advertising the bind address, which is why it is stated here.',
        },
      ],
    },
    {
      id: 'registration',
      heading: 'Dynamic client registration',
      blocks: [
        {
          kind: 'code',
          label: 'http',
          lines: [
            'POST /api/oauth/register',
            'content-type: application/json',
            '',
            '{',
            '  "client_name": "Example Assistant",',
            '  "redirect_uris": ["https://example.com/oauth/callback"],',
            '  "token_endpoint_auth_method": "none",',
            '  "application_type": "native"',
            '}',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'RFC 7591. The response is `201` with a `client_id`, and - only for a confidential client - a `client_secret`, returned exactly once because only its hash is stored.',
          ],
        },
        {
          kind: 'table',
          head: ['Field', 'Required', 'Notes'],
          rows: [
            [
              '`redirect_uris`',
              'Yes',
              'One to ten URIs. Every one must be `https`, or `http` on `localhost` or `127.0.0.1` for a native client in development. Plain `http` to a public host is refused, because it would leak the authorization code in transit',
            ],
            [
              '`client_name`',
              'No',
              'Shown on the consent screen. Defaults to `Unnamed MCP client`',
            ],
            [
              '`token_endpoint_auth_method`',
              'No',
              '`none` for a public client, which proves itself with the PKCE verifier, or `client_secret_post` for a confidential one. Defaults to `none`',
            ],
            ['`application_type`', 'No', '`native` or `web`. Defaults to `native`'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Fields outside that set are accepted and ignored rather than stored. An unused column in a table that anyone on the internet can write to is a liability, not a feature.',
          ],
        },
        {
          kind: 'note',
          text: '**This endpoint is unauthenticated, and the specification requires that.** Any client on the internet may register, which is how a directory-listed connector obtains credentials without a human ever visiting the site. Registration grants nothing on its own: a client with no authorization code can read no data at all. Access exists only once a person has approved a code inside their own workspace.',
        },
      ],
    },
    {
      id: 'authorize',
      heading: 'The authorization request',
      blocks: [
        {
          kind: 'code',
          label: 'url',
          lines: [
            'https://app.mneia.dev/oauth/authorize',
            '  ?client_id=mneia_client_...',
            '  &redirect_uri=https://example.com/oauth/callback',
            '  &response_type=code',
            '  &code_challenge=<base64url(sha256(verifier))>',
            '  &code_challenge_method=S256',
            '  &state=<opaque>',
            '  &resource=https://app.mneia.dev/api/mcp',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The person is signed in first - the consent screen is not a public page, because their session is the only source of the workspace a code can be issued for. They then see which application is asking, which workspace it would reach, and that it would act as them.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'A `client_id` that is not registered is refused **on the page**, not by redirect.',
            'A `redirect_uri` the client did not register is refused on the page too. Sending an error to an unverified URI is how an authorization code ends up somewhere it should not be, so nothing leaves the page until the URI is known to belong to the client.',
            'A `response_type` other than `code`, or a missing or non-`S256` PKCE challenge, is refused with the reason named.',
            'Denial redirects with `error=access_denied` to the registered URI, carrying `state` back.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'On approval the client is redirected back with `code` and `state`. **The workspace and the actor come from the signed-in session and never from the request**, so a code can only ever be issued for a workspace the approver actually belongs to. Every security-relevant check is re-derived when the form is submitted rather than trusted from the rendered page, because a form post is a separate request and a page is not a security boundary.',
            '`resource` is RFC 8707 and is carried through onto the code. The 2025-06-18 MCP revision made audience validation mandatory, so a client must be able to say which resource server it wants a token for.',
          ],
        },
      ],
    },
    {
      id: 'token',
      heading: 'The token exchange',
      blocks: [
        {
          kind: 'code',
          label: 'http',
          lines: [
            'POST /api/oauth/token',
            'content-type: application/x-www-form-urlencoded',
            '',
            'grant_type=authorization_code',
            '&code=<the code from the redirect>',
            '&client_id=mneia_client_...',
            '&code_verifier=<the original verifier>',
            '&redirect_uri=https://example.com/oauth/callback',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The request is form-encoded, not JSON. That is the specification, and a client that sends JSON here will fail against every other authorization server too, so it is refused rather than accommodated.',
            'The answer is `{ "access_token": "...", "token_type": "Bearer", "scope": "mcp" }`, with `cache-control: no-store` - it carries a credential.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'An authorization code lives for **120 seconds**. A client that already holds the verifier exchanges it immediately, so a longer window only widens the replay opportunity for a code that leaked through a redirect.',
            'The code is stored as a hash, never in the clear, so a leaked database row cannot be replayed as a code.',
            'It must be presented by the client it was issued to, and returned to the redirect URI it was bound to. Both are checked.',
            'The PKCE verifier is checked against the stored challenge with a constant-time comparison.',
            '**Spending the code and minting the token are one transaction.** A code is never consumed without a token coming back, so a client is never left holding a spent code and nothing to retry with. A second request for the same code gets `invalid_grant`.',
          ],
        },
        {
          kind: 'table',
          head: ['Error', 'Status', 'Means'],
          rows: [
            [
              '`invalid_request`',
              '`400`',
              'A required parameter was missing, or the content type was wrong',
            ],
            [
              '`invalid_client`',
              '`401`',
              'No client is registered with that id, or a confidential client presented the wrong secret',
            ],
            [
              '`invalid_grant`',
              '`400`',
              'The code expired, was already exchanged, belongs to another client, came back to a different redirect URI, or the verifier does not match',
            ],
            [
              '`unsupported_grant_type`',
              '`400`',
              'Something other than `authorization_code`. Refresh tokens and client credentials are not issued',
            ],
            ['`server_error`', '`500`', 'Nothing was issued. Start the authorization again'],
          ],
        },
        {
          kind: 'note',
          text: '**No refresh tokens.** There is one grant type and one scope. A second scope would exist only if there were a second thing to grant, and inventing one before that is true would advertise a distinction the server does not enforce.',
        },
      ],
    },
    {
      id: 'token-shape',
      heading: 'What the token is',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The access token is an ordinary `api_token` row - the same kind `mneia login` produces. That is the point of the design rather than an implementation shortcut: bearer resolution, revocation, expiry, and the tokens page in the web app all keep working unchanged, and there is no second credential system to keep in step with the first.',
            'It is scoped to one workspace and one actor. It cannot reach another workspace, and it can do exactly what that person can do - no more. Revoke it from the tokens page in the web app, at any time, without involving the client that holds it.',
          ],
        },
        {
          kind: 'code',
          label: 'http',
          lines: [
            'POST /api/mcp',
            'authorization: Bearer mneia_...',
            'content-type: application/json',
            'accept: application/json, text/event-stream',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`/api/mcp` speaks MCP over Streamable HTTP, and it is stateless on purpose: no session id is issued and no per-connection state is kept, so a client may be answered by any container and a deploy cannot strand a session in the middle of a task.',
          ],
        },
        {
          kind: 'note',
          text: 'Every rule on `/docs/security` still applies to a request that arrives this way. Row-level security is keyed on the workspace resolved from the token, so an OAuth client is isolated by exactly the mechanism everything else is isolated by, not by a check written specially for it.',
        },
      ],
    },
    {
      id: 'storage',
      heading: 'What is stored',
      blocks: [
        {
          kind: 'table',
          head: ['Table', 'Holds'],
          rows: [
            [
              '`oauth_client`',
              'A registration: the generated `client_id`, the name, the redirect URIs, the grant and response types, the auth method and application type, and the hash of a secret where the client has one',
            ],
            [
              '`oauth_authorization_code`',
              'One issued code: its hash, the client, the workspace and actor it was approved for, the redirect URI it is bound to, the PKCE challenge and method, the requested resource and scope, its status, and when it expires or was redeemed',
            ],
            [
              '`api_token`',
              'The access token itself, as a hash, alongside every other token in the workspace',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`oauth_client` is the one table in the system a stranger can write to, and it carries nothing about anyone’s data. `oauth_authorization_code` carries a workspace, so it is under row-level security like every other tenant table - see `/docs/data-model`.',
          ],
        },
      ],
    },
  ],
};
