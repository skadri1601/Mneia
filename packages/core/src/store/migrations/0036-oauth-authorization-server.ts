import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;
const WORKSPACE_BLANK = `NULLIF(current_setting('mneia.workspace_id', true), '') IS NULL`;
const CLIENT_ID_GUC = `NULLIF(current_setting('mneia.oauth_client_id', true), '')`;
const CODE_HASH_GUC = `NULLIF(current_setting('mneia.oauth_code_hash', true), '')`;

/**
 * OAuth 2.1 authorization server for the remote MCP endpoint (MNE-79).
 *
 * Neither table is in vision.md §9, and that is deliberate rather than an oversight: §9 specifies
 * the domain model, while these sit beside `api_token`, `device_authorization` and
 * `rate_limit_counter` as infrastructure the product needs but does not reason about. The device
 * grant is the direct precedent and this migration follows its shape closely.
 *
 * Why it exists at all: connecting a remote MCP server by hand needs no OAuth — claude.ai accepts
 * request headers and ChatGPT developer mode accepts an API key — but *publishing* to the Anthropic
 * Connectors Directory or the OpenAI Plugin Directory requires OAuth 2.1, and the latter requires
 * dynamic client registration.
 *
 * The access token an exchange issues is an ordinary `api_token` row. That is the whole point of
 * the design: revocation, listing, expiry and `resolveBearerIdentity` already exist and keep
 * working, and there is exactly one kind of credential the API has to understand.
 */
export const migration: Migration = {
  version: 36,
  name: 'oauth-authorization-server',
  sql: `
-- Dynamically registered clients. Not workspace-scoped on purpose: a client registers before any
-- human has authorized anything, so at registration time there is no tenant to attribute it to.
-- It becomes tenant-bound only through an authorization code, which is.
CREATE TABLE oauth_client (
  id                          UUID PRIMARY KEY,
  client_id                   TEXT NOT NULL,
  client_secret_hash          TEXT,
  client_name                 TEXT NOT NULL,
  redirect_uris               TEXT[] NOT NULL,
  grant_types                 TEXT[] NOT NULL DEFAULT ARRAY['authorization_code'],
  response_types              TEXT[] NOT NULL DEFAULT ARRAY['code'],
  token_endpoint_auth_method  TEXT NOT NULL DEFAULT 'none'
                                CHECK (token_endpoint_auth_method IN ('none', 'client_secret_post', 'client_secret_basic')),
  -- Required on registration by the 2026-07-28 revision.
  application_type            TEXT NOT NULL DEFAULT 'native'
                                CHECK (application_type IN ('native', 'web')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT oauth_client_has_redirect_uri
    CHECK (cardinality(redirect_uris) > 0),
  -- A public client authenticates by proving possession of the PKCE verifier, not with a secret.
  -- Anything else must hold one, or the token endpoint has nothing to check.
  CONSTRAINT oauth_client_secret_matches_auth_method
    CHECK ((token_endpoint_auth_method = 'none') = (client_secret_hash IS NULL))
);

CREATE UNIQUE INDEX oauth_client_client_id_key ON oauth_client (client_id);

-- Authorization codes. Short-lived, single-use, and bound to the workspace and actor that approved
-- them, so redeeming one cannot mint a token for a tenant the approver never had access to.
CREATE TABLE oauth_authorization_code (
  id                     UUID PRIMARY KEY,
  code_hash              TEXT NOT NULL,
  client_id              TEXT NOT NULL REFERENCES oauth_client (client_id) ON DELETE CASCADE,
  workspace_id           UUID NOT NULL REFERENCES workspace (id),
  actor_id               UUID NOT NULL,
  redirect_uri           TEXT NOT NULL,
  -- PKCE is mandatory in OAuth 2.1 and S256 is the only method worth accepting; "plain" offers no
  -- protection against an intercepted code, which is the entire threat PKCE addresses.
  code_challenge         TEXT NOT NULL,
  code_challenge_method  TEXT NOT NULL DEFAULT 'S256'
                           CHECK (code_challenge_method = 'S256'),
  -- RFC 8707. The audience the resulting token is for; the 2025-06-18 revision made validating it
  -- mandatory so a token minted for one resource server cannot be replayed against another.
  resource               TEXT,
  scope                  TEXT NOT NULL DEFAULT '',
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'redeemed')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at             TIMESTAMPTZ NOT NULL,
  redeemed_at            TIMESTAMPTZ,
  CONSTRAINT oauth_authorization_code_expires_after_creation
    CHECK (expires_at > created_at),
  CONSTRAINT oauth_authorization_code_redeemed_at_matches_status
    CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL)),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES actor (workspace_id, id)
);

CREATE UNIQUE INDEX oauth_authorization_code_code_hash_key
  ON oauth_authorization_code (code_hash);

CREATE INDEX oauth_authorization_code_expiry_idx
  ON oauth_authorization_code (expires_at);

-- The secrets and the binding are immutable, and a code moves to 'redeemed' exactly once. Single
-- use is what stops a replayed code from minting a second token, so it is enforced here rather
-- than left to the application to remember.
CREATE FUNCTION mneia_oauth_authorization_code_write_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.code_hash             IS DISTINCT FROM OLD.code_hash
  OR NEW.client_id             IS DISTINCT FROM OLD.client_id
  OR NEW.workspace_id          IS DISTINCT FROM OLD.workspace_id
  OR NEW.actor_id              IS DISTINCT FROM OLD.actor_id
  OR NEW.redirect_uri          IS DISTINCT FROM OLD.redirect_uri
  OR NEW.code_challenge        IS DISTINCT FROM OLD.code_challenge
  OR NEW.code_challenge_method IS DISTINCT FROM OLD.code_challenge_method
  OR NEW.resource              IS DISTINCT FROM OLD.resource
  OR NEW.scope                 IS DISTINCT FROM OLD.scope
  OR NEW.created_at            IS DISTINCT FROM OLD.created_at
  OR NEW.expires_at            IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'an authorization code binding and lifetime are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'redeemed' THEN
    NEW.redeemed_at := COALESCE(NEW.redeemed_at, now());
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'an authorization code cannot move from % to %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER oauth_authorization_code_transition_guard
  BEFORE UPDATE ON oauth_authorization_code
  FOR EACH ROW
  EXECUTE FUNCTION mneia_oauth_authorization_code_write_guard();

ALTER TABLE oauth_client ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_client FORCE ROW LEVEL SECURITY;

-- Registration is unauthenticated by design — that is what dynamic client registration means — so
-- the insert policy cannot key on a workspace. It is gated at the application edge by the same
-- rate limiter every other public route uses.
CREATE POLICY oauth_client_register ON oauth_client
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (${WORKSPACE_BLANK});

-- Reading a client back is keyed on knowing its id, which authorize and token both have.
CREATE POLICY oauth_client_lookup ON oauth_client
  AS PERMISSIVE
  FOR SELECT
  USING (client_id = ${CLIENT_ID_GUC});

ALTER TABLE oauth_authorization_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_code FORCE ROW LEVEL SECURITY;

-- Issuing a code happens inside the approving human's workspace scope, so the row can only ever be
-- written for the workspace that actually approved it.
CREATE POLICY oauth_authorization_code_issue ON oauth_authorization_code
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (
    workspace_id = ${WORKSPACE_GUC}
    AND status = 'pending'
    AND redeemed_at IS NULL
  );

-- Redemption happens before any workspace is known — the token endpoint holds only the code — so
-- this policy is keyed on the code hash instead, exactly as the device grant polls on its own.
CREATE POLICY oauth_authorization_code_redeem_lookup ON oauth_authorization_code
  AS PERMISSIVE
  FOR SELECT
  USING (
    code_hash = ${CODE_HASH_GUC}
    AND ${WORKSPACE_BLANK}
  );

CREATE POLICY oauth_authorization_code_redeem ON oauth_authorization_code
  AS PERMISSIVE
  FOR UPDATE
  USING (
    code_hash = ${CODE_HASH_GUC}
    AND status = 'pending'
    AND expires_at > now()
  )
  WITH CHECK (
    code_hash = ${CODE_HASH_GUC}
    AND status = 'redeemed'
  );

-- A workspace can see the codes issued against it, which is what makes an audit view possible.
CREATE POLICY oauth_authorization_code_workspace_isolation ON oauth_authorization_code
  AS PERMISSIVE
  FOR SELECT
  USING (workspace_id = ${WORKSPACE_GUC});

-- Grant the application role explicitly rather than relying on ALTER DEFAULT PRIVILEGES.
--
-- db:provision-app-role sets default privileges, and they did NOT cover these tables: verified by
-- revoking and watching /api/oauth/register answer 500 with has_table_privilege returning false.
-- Default privileges only apply to objects created by the role that ran the ALTER, which is not a
-- property this migration can depend on across every environment.
--
-- Without this the endpoints fail the moment the migration lands, and the deploy gate would not
-- catch it: the schema is current, so the gate passes and the application breaks after shipping.
-- Guarded on the role existing so a database provisioned without one still migrates.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mneia_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_client TO mneia_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON oauth_authorization_code TO mneia_app;
  END IF;
END
$$;
`,
};
