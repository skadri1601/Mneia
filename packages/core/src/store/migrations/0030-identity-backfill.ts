import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 30,
  name: 'identity-backfill',
  sql: `
INSERT INTO identity (id, subject)
SELECT gen_random_uuid(), missing.external_ref
FROM (
  SELECT DISTINCT actor.external_ref
  FROM actor
  WHERE actor.kind = 'human'::actor_kind
    AND actor.identity_id IS NULL
    AND actor.external_ref IS NOT NULL
    AND actor.external_ref <> ''
) AS missing
WHERE NOT EXISTS (
  SELECT 1 FROM identity WHERE identity.subject = missing.external_ref
);

UPDATE actor
SET identity_id = identity.id
FROM identity
WHERE actor.kind = 'human'::actor_kind
  AND actor.identity_id IS NULL
  AND actor.external_ref = identity.subject;

INSERT INTO workspace_member (workspace_id, identity_id, role)
SELECT actor.workspace_id,
       actor.identity_id,
       CASE
         WHEN actor.id = founder.id THEN 'owner'::workspace_role
         WHEN membership.role = 'lead'::team_role THEN 'admin'::workspace_role
         ELSE 'member'::workspace_role
       END
FROM actor
JOIN LATERAL (
  SELECT earliest.id
  FROM actor AS earliest
  WHERE earliest.workspace_id = actor.workspace_id
    AND earliest.kind = 'human'::actor_kind
  ORDER BY earliest.created_at ASC, earliest.id ASC
  LIMIT 1
) AS founder ON true
LEFT JOIN LATERAL (
  SELECT team_member.role
  FROM team_member
  WHERE team_member.workspace_id = actor.workspace_id
    AND team_member.actor_id = actor.id
  ORDER BY team_member.added_at ASC
  LIMIT 1
) AS membership ON true
WHERE actor.kind = 'human'::actor_kind
  AND actor.identity_id IS NOT NULL
ON CONFLICT (workspace_id, identity_id) DO NOTHING;

ALTER TABLE actor
  ADD CONSTRAINT actor_identified_human_carries_an_identity
  CHECK (
    kind <> 'human'::actor_kind
    OR external_ref IS NULL
    OR external_ref = ''
    OR identity_id IS NOT NULL
  );
`,
};
