import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;
const WORKSPACE_BLANK = `NULLIF(current_setting('mneia.workspace_id', true), '') IS NULL`;
const INVITATION_TOKEN_GUC = `NULLIF(current_setting('mneia.invitation_token_hash', true), '')`;
const INVITATION_EMAIL_GUC = `NULLIF(current_setting('mneia.invitation_email', true), '')`;

export const migration: Migration = {
  version: 16,
  name: 'workspace-invitation',
  sql: `
CREATE TABLE workspace_invitation (
  id                 UUID PRIMARY KEY,
  workspace_id       UUID NOT NULL REFERENCES workspace (id),
  team_id            UUID NOT NULL,
  invited_email      TEXT NOT NULL,
  token_hash         TEXT NOT NULL,
  role               team_role NOT NULL DEFAULT 'member',
  invited_by         UUID NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL,
  accepted_at        TIMESTAMPTZ,
  accepted_actor_id  UUID,
  revoked_at         TIMESTAMPTZ,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES team (workspace_id, id),
  FOREIGN KEY (workspace_id, invited_by) REFERENCES actor (workspace_id, id),
  FOREIGN KEY (workspace_id, accepted_actor_id) REFERENCES actor (workspace_id, id),
  CONSTRAINT workspace_invitation_email_is_normalized
    CHECK (invited_email = lower(btrim(invited_email)) AND position('@' IN invited_email) > 1),
  CONSTRAINT workspace_invitation_acceptance_is_whole
    CHECK ((accepted_at IS NULL) = (accepted_actor_id IS NULL)),
  CONSTRAINT workspace_invitation_is_not_both_accepted_and_revoked
    CHECK (accepted_at IS NULL OR revoked_at IS NULL),
  CONSTRAINT workspace_invitation_expires_after_creation
    CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX workspace_invitation_token_hash_key
  ON workspace_invitation (token_hash);

CREATE UNIQUE INDEX workspace_invitation_one_live_per_email
  ON workspace_invitation (workspace_id, invited_email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX workspace_invitation_invited_email_idx
  ON workspace_invitation (invited_email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX workspace_invitation_workspace_idx
  ON workspace_invitation (workspace_id, created_at DESC);

CREATE FUNCTION mneia_workspace_invitation_write_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id            IS DISTINCT FROM OLD.id
  OR NEW.workspace_id  IS DISTINCT FROM OLD.workspace_id
  OR NEW.team_id       IS DISTINCT FROM OLD.team_id
  OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
  OR NEW.token_hash    IS DISTINCT FROM OLD.token_hash
  OR NEW.role          IS DISTINCT FROM OLD.role
  OR NEW.invited_by    IS DISTINCT FROM OLD.invited_by
  OR NEW.created_at    IS DISTINCT FROM OLD.created_at
  OR NEW.expires_at    IS DISTINCT FROM OLD.expires_at THEN
    RAISE EXCEPTION 'a workspace invitation is immutable apart from being accepted or revoked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.accepted_at IS NOT NULL OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'a workspace invitation can only be settled once'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.accepted_at IS NOT NULL AND NEW.expires_at <= now() THEN
    RAISE EXCEPTION 'an expired workspace invitation cannot be accepted'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_invitation_transition_guard
  BEFORE UPDATE ON workspace_invitation
  FOR EACH ROW
  EXECUTE FUNCTION mneia_workspace_invitation_write_guard();

ALTER TABLE workspace_invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_invitation FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_invitation_workspace_isolation ON workspace_invitation
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});

CREATE POLICY workspace_invitation_token_lookup ON workspace_invitation
  AS PERMISSIVE
  FOR SELECT
  USING (
    token_hash = ${INVITATION_TOKEN_GUC}
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
    AND ${WORKSPACE_BLANK}
  );

CREATE POLICY workspace_invitation_email_lookup ON workspace_invitation
  AS PERMISSIVE
  FOR SELECT
  USING (
    invited_email = ${INVITATION_EMAIL_GUC}
    AND accepted_at IS NULL
    AND revoked_at IS NULL
    AND expires_at > now()
    AND ${WORKSPACE_BLANK}
  );
`,
};
