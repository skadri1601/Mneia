import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 25,
  name: 'project-file-binding',
  sql: `
CREATE TABLE project_file_binding (
  workspace_id      UUID NOT NULL REFERENCES workspace (id),
  project_id        UUID NOT NULL,
  path              TEXT NOT NULL,
  fence_checksum    TEXT,
  last_imported_at  TIMESTAMPTZ,
  last_written_at   TIMESTAMPTZ,
  PRIMARY KEY (workspace_id, project_id, path),
  FOREIGN KEY (workspace_id, project_id)
    REFERENCES project (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT project_file_binding_path_is_relative
    CHECK (path <> '' AND path NOT LIKE '/%' AND path NOT LIKE '%..%')
);

ALTER TABLE project_file_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_file_binding FORCE ROW LEVEL SECURITY;

CREATE POLICY project_file_binding_workspace_isolation ON project_file_binding
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
