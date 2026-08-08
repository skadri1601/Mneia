import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;
const WORKSPACE_BLANK = `NULLIF(current_setting('mneia.workspace_id', true), '') IS NULL`;
const IDENTITY_SUBJECT_GUC = `NULLIF(current_setting('mneia.identity_subject', true), '')`;

export const migration: Migration = {
  version: 17,
  name: 'identity-and-workspace-membership',
  sql: `
CREATE TABLE identity (
  id          UUID PRIMARY KEY,
  subject     TEXT NOT NULL,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT identity_subject_is_not_blank CHECK (subject <> ''),
  CONSTRAINT identity_email_is_normalized
    CHECK (email IS NULL OR (email = lower(btrim(email)) AND position('@' IN email) > 1))
);

CREATE UNIQUE INDEX identity_subject_key ON identity (subject);

CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE workspace_member (
  workspace_id  UUID NOT NULL REFERENCES workspace (id),
  identity_id   UUID NOT NULL REFERENCES identity (id),
  role          workspace_role NOT NULL DEFAULT 'member',
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_by    UUID REFERENCES identity (id),
  PRIMARY KEY (workspace_id, identity_id)
);

CREATE INDEX workspace_member_identity_idx ON workspace_member (identity_id);

ALTER TABLE actor ADD COLUMN identity_id UUID REFERENCES identity (id);

ALTER TABLE actor
  ADD CONSTRAINT actor_identity_belongs_to_humans
  CHECK (kind = 'human'::actor_kind OR identity_id IS NULL);

CREATE INDEX actor_identity_idx ON actor (identity_id) WHERE identity_id IS NOT NULL;

INSERT INTO identity (id, subject)
SELECT gen_random_uuid(), a.external_ref
FROM (
  SELECT DISTINCT external_ref
  FROM actor
  WHERE kind = 'human'::actor_kind AND external_ref IS NOT NULL AND external_ref <> ''
) AS a;

UPDATE actor
SET identity_id = identity.id
FROM identity
WHERE actor.kind = 'human'::actor_kind
  AND actor.external_ref = identity.subject;

INSERT INTO workspace_member (workspace_id, identity_id, role)
SELECT DISTINCT actor.workspace_id, actor.identity_id, 'owner'::workspace_role
FROM actor
WHERE actor.identity_id IS NOT NULL;

DROP INDEX actor_human_external_ref_unique;

CREATE UNIQUE INDEX actor_human_external_ref_unique
  ON actor (workspace_id, external_ref)
  WHERE external_ref IS NOT NULL AND kind = 'human'::actor_kind;

ALTER TABLE workspace_invitation ALTER COLUMN role DROP DEFAULT;

ALTER TABLE workspace_invitation
  ALTER COLUMN role TYPE workspace_role
  USING (CASE WHEN role = 'lead'::team_role THEN 'admin' ELSE 'member' END)::workspace_role;

ALTER TABLE workspace_invitation ALTER COLUMN role SET DEFAULT 'member'::workspace_role;

ALTER TABLE workspace_invitation ALTER COLUMN team_id DROP NOT NULL;

ALTER TABLE identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity FORCE ROW LEVEL SECURITY;

CREATE POLICY identity_subject_lookup ON identity
  AS PERMISSIVE
  FOR SELECT
  USING (subject = ${IDENTITY_SUBJECT_GUC});

CREATE POLICY identity_subject_enrolment ON identity
  AS PERMISSIVE
  FOR INSERT
  WITH CHECK (subject = ${IDENTITY_SUBJECT_GUC});

ALTER TABLE workspace_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_member FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_member_workspace_isolation ON workspace_member
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});

CREATE POLICY workspace_member_identity_lookup ON workspace_member
  AS PERMISSIVE
  FOR SELECT
  USING (
    ${WORKSPACE_BLANK}
    AND EXISTS (
      SELECT 1
      FROM identity
      WHERE identity.id = workspace_member.identity_id
        AND identity.subject = ${IDENTITY_SUBJECT_GUC}
    )
  );
`,
};
