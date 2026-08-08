import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 22,
  name: 'context-item-grant',
  sql: `
CREATE TYPE grantee_kind AS ENUM ('actor', 'team');

CREATE TABLE context_item_grant (
  workspace_id  UUID NOT NULL REFERENCES workspace (id),
  item_id       UUID NOT NULL,
  grantee_kind  grantee_kind NOT NULL,
  grantee_id    UUID NOT NULL,
  granted_by    UUID NOT NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, grantee_kind, grantee_id),
  FOREIGN KEY (workspace_id, item_id)
    REFERENCES context_item (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, granted_by) REFERENCES actor (workspace_id, id)
);

CREATE INDEX context_item_grant_grantee_idx
  ON context_item_grant (workspace_id, grantee_kind, grantee_id);

ALTER TABLE context_item_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_item_grant FORCE ROW LEVEL SECURITY;

CREATE POLICY context_item_grant_workspace_isolation ON context_item_grant
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});

CREATE INDEX context_item_load_bearing_idx
  ON context_item (workspace_id, project_id)
  WHERE status = 'active'::item_status AND load_bearing AND valid_to IS NULL;
`,
};
