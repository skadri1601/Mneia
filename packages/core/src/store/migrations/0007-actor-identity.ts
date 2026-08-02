import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 7,
  name: 'actor-identity',
  sql: `
CREATE UNIQUE INDEX actor_human_external_ref_unique
  ON actor (external_ref)
  WHERE external_ref IS NOT NULL AND kind = 'human'::actor_kind;

CREATE POLICY actor_identity_lookup ON actor
  AS PERMISSIVE
  FOR SELECT
  USING (
    kind = 'human'::actor_kind
    AND external_ref = NULLIF(current_setting('mneia.identity_subject', true), '')
    AND NULLIF(current_setting('mneia.workspace_id', true), '') IS NULL
  );`,
};
