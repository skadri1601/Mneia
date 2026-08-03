import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;
const WORKSPACE_BLANK = `NULLIF(current_setting('mneia.workspace_id', true), '') IS NULL`;
const DEVICE_CODE_GUC = `NULLIF(current_setting('mneia.device_code_hash', true), '')`;
const USER_CODE_GUC = `NULLIF(current_setting('mneia.device_user_code', true), '')`;
const API_TOKEN_GUC = `NULLIF(current_setting('mneia.api_token_hash', true), '')`;

export const migration: Migration = {
  version: 11,
  name: 'device-authorization',
  sql: `
CREATE TABLE device_authorization (
  id                    UUID PRIMARY KEY,
  device_code_hash      TEXT NOT NULL,
  user_code             TEXT NOT NULL,
  confirmation_code     TEXT NOT NULL,
  client_label          TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'approved', 'denied', 'redeemed')),
  claimed_workspace_id  UUID REFERENCES workspace (id),
  claimed_actor_id      UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at            TIMESTAMPTZ NOT NULL,
  claimed_at            TIMESTAMPTZ,
  redeemed_at           TIMESTAMPTZ,
  CONSTRAINT device_authorization_claim_is_whole
    CHECK ((claimed_workspace_id IS NULL) = (claimed_actor_id IS NULL)),
  CONSTRAINT device_authorization_claim_matches_status
    CHECK ((status = 'pending') = (claimed_workspace_id IS NULL)),
  CONSTRAINT device_authorization_claimed_at_matches_claim
    CHECK ((claimed_at IS NULL) = (claimed_workspace_id IS NULL)),
  CONSTRAINT device_authorization_redeemed_at_matches_status
    CHECK ((status = 'redeemed') = (redeemed_at IS NOT NULL)),
  CONSTRAINT device_authorization_expires_after_creation
    CHECK (expires_at > created_at),
  FOREIGN KEY (claimed_workspace_id, claimed_actor_id) REFERENCES actor (workspace_id, id)
);

CREATE UNIQUE INDEX device_authorization_device_code_hash_key
  ON device_authorization (device_code_hash);

CREATE UNIQUE INDEX device_authorization_user_code_key
  ON device_authorization (user_code);

CREATE INDEX device_authorization_expiry_idx
  ON device_authorization (expires_at);

CREATE FUNCTION mneia_device_authorization_write_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.device_code_hash  IS DISTINCT FROM OLD.device_code_hash
  OR NEW.user_code         IS DISTINCT FROM OLD.user_code
  OR NEW.confirmation_code IS DISTINCT FROM OLD.confirmation_code
  OR NEW.created_at        IS DISTINCT FROM OLD.created_at
  OR NEW.expires_at        IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'device authorization secrets and lifetime are immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'denied') THEN
    IF NEW.claimed_workspace_id IS NULL OR NEW.claimed_actor_id IS NULL THEN
      RAISE EXCEPTION 'a device authorization decision must record the deciding workspace and actor'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.claimed_at := COALESCE(NEW.claimed_at, now());
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'redeemed' THEN
    IF NEW.claimed_workspace_id IS DISTINCT FROM OLD.claimed_workspace_id
    OR NEW.claimed_actor_id     IS DISTINCT FROM OLD.claimed_actor_id THEN
      RAISE EXCEPTION 'redeeming a device authorization cannot move it to another workspace'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.redeemed_at := COALESCE(NEW.redeemed_at, now());
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'device authorization status cannot move from % to %', OLD.status, NEW.status
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER device_authorization_transition_guard
  BEFORE UPDATE ON device_authorization
  FOR EACH ROW
  EXECUTE FUNCTION mneia_device_authorization_write_guard();

ALTER TABLE device_authorization ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_authorization FORCE ROW LEVEL SECURITY;

CREATE POLICY device_authorization_start ON device_authorization
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (
    status = 'pending'
    AND claimed_workspace_id IS NULL
    AND claimed_actor_id IS NULL
    AND redeemed_at IS NULL
    AND device_code_hash = ${DEVICE_CODE_GUC}
    AND ${WORKSPACE_BLANK}
  );

CREATE POLICY device_authorization_poll ON device_authorization
  AS PERMISSIVE
  FOR SELECT
  USING (
    device_code_hash = ${DEVICE_CODE_GUC}
    AND ${WORKSPACE_BLANK}
  );

CREATE POLICY device_authorization_user_code_lookup ON device_authorization
  AS PERMISSIVE
  FOR SELECT
  USING (
    user_code = ${USER_CODE_GUC}
    AND status = 'pending'
    AND expires_at > now()
  );

CREATE POLICY device_authorization_workspace_isolation ON device_authorization
  AS PERMISSIVE
  FOR SELECT
  USING (claimed_workspace_id = ${WORKSPACE_GUC});

CREATE POLICY device_authorization_claim ON device_authorization
  AS PERMISSIVE
  FOR UPDATE
  USING (
    user_code = ${USER_CODE_GUC}
    AND status = 'pending'
    AND claimed_workspace_id IS NULL
    AND expires_at > now()
  )
  WITH CHECK (
    status IN ('approved', 'denied')
    AND user_code = ${USER_CODE_GUC}
    AND claimed_workspace_id = ${WORKSPACE_GUC}
  );

CREATE POLICY device_authorization_redemption ON device_authorization
  AS PERMISSIVE
  FOR UPDATE
  USING (
    device_code_hash = ${DEVICE_CODE_GUC}
    AND claimed_workspace_id = ${WORKSPACE_GUC}
    AND status = 'approved'
    AND expires_at > now()
  )
  WITH CHECK (
    status = 'redeemed'
    AND claimed_workspace_id = ${WORKSPACE_GUC}
  );

CREATE TABLE api_token (
  id                       UUID PRIMARY KEY,
  workspace_id             UUID NOT NULL REFERENCES workspace (id),
  actor_id                 UUID NOT NULL,
  token_hash               TEXT NOT NULL,
  label                    TEXT NOT NULL DEFAULT '',
  device_authorization_id  UUID REFERENCES device_authorization (id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at             TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  revoked_at               TIMESTAMPTZ,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES actor (workspace_id, id)
);

CREATE UNIQUE INDEX api_token_token_hash_key ON api_token (token_hash);

CREATE INDEX api_token_workspace_actor_idx
  ON api_token (workspace_id, actor_id, created_at DESC);

ALTER TABLE api_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_token FORCE ROW LEVEL SECURITY;

CREATE POLICY api_token_workspace_isolation ON api_token
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});

CREATE POLICY api_token_bearer_lookup ON api_token
  AS PERMISSIVE
  FOR SELECT
  USING (
    token_hash = ${API_TOKEN_GUC}
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND ${WORKSPACE_BLANK}
  );

CREATE TABLE device_approval_attempt (
  workspace_id       UUID NOT NULL REFERENCES workspace (id),
  actor_id           UUID NOT NULL,
  window_started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  failed_attempts    INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  PRIMARY KEY (workspace_id, actor_id),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES actor (workspace_id, id)
);

ALTER TABLE device_approval_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_approval_attempt FORCE ROW LEVEL SECURITY;

CREATE POLICY device_approval_attempt_workspace_isolation ON device_approval_attempt
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
