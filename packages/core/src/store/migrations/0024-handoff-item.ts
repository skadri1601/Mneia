import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 24,
  name: 'handoff-item',
  sql: `
CREATE TABLE handoff_item (
  workspace_id  UUID NOT NULL REFERENCES workspace (id),
  handoff_id    UUID NOT NULL,
  item_id       UUID NOT NULL,
  section       TEXT NOT NULL,
  PRIMARY KEY (handoff_id, item_id),
  FOREIGN KEY (workspace_id, handoff_id)
    REFERENCES handoff (workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, item_id) REFERENCES context_item (workspace_id, id),
  CONSTRAINT handoff_item_section_is_not_blank CHECK (section <> '')
);

CREATE INDEX handoff_item_item_idx ON handoff_item (workspace_id, item_id);

ALTER TABLE handoff_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE handoff_item FORCE ROW LEVEL SECURITY;

CREATE POLICY handoff_item_workspace_isolation ON handoff_item
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
