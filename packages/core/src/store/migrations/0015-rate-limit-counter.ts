import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 15,
  name: 'rate-limit-counter',
  sql: `
CREATE TABLE rate_limit_counter (
  workspace_id  UUID NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  subject       TEXT NOT NULL,
  bucket        TEXT NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (workspace_id, subject, bucket, window_start)
);

CREATE INDEX rate_limit_counter_sweep_idx
  ON rate_limit_counter (workspace_id, window_start);

ALTER TABLE rate_limit_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit_counter FORCE ROW LEVEL SECURITY;

CREATE POLICY rate_limit_counter_workspace_isolation ON rate_limit_counter
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
