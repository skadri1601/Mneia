import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 26,
  name: 'workspace-usage-period',
  sql: `
CREATE TABLE workspace_usage_period (
  workspace_id      UUID NOT NULL REFERENCES workspace (id) ON DELETE CASCADE,
  period_start      DATE NOT NULL,
  checkpoints_used  INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, period_start),
  CONSTRAINT workspace_usage_period_checkpoints_are_not_negative
    CHECK (checkpoints_used >= 0),
  CONSTRAINT workspace_usage_period_starts_on_a_month
    CHECK (period_start = date_trunc('month', period_start)::date)
);

ALTER TABLE workspace_usage_period ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_usage_period FORCE ROW LEVEL SECURITY;

CREATE POLICY workspace_usage_period_workspace_isolation ON workspace_usage_period
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
