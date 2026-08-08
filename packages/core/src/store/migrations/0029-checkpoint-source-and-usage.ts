import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 29,
  name: 'checkpoint-source-and-usage',
  sql: `
ALTER TABLE checkpoint
  ADD COLUMN source TEXT,
  ADD COLUMN source_session_ref TEXT,
  ADD COLUMN source_watermark TEXT;

ALTER TABLE checkpoint
  ADD CONSTRAINT checkpoint_source_fields_are_not_blank
  CHECK (
    (source IS NULL OR source <> '')
    AND (source_session_ref IS NULL OR source_session_ref <> '')
    AND (source_watermark IS NULL OR source_watermark <> '')
  );

ALTER TABLE checkpoint
  ADD CONSTRAINT checkpoint_source_watermark_needs_a_session
  CHECK (source_watermark IS NULL OR (source IS NOT NULL AND source_session_ref IS NOT NULL));

CREATE TABLE checkpoint_usage (
  id             UUID PRIMARY KEY,
  workspace_id   UUID NOT NULL REFERENCES workspace (id),
  checkpoint_id  UUID,
  model          TEXT NOT NULL,
  input_tokens   INTEGER NOT NULL,
  output_tokens  INTEGER NOT NULL,
  duration_ms    INTEGER NOT NULL,
  outcome        TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, checkpoint_id) REFERENCES checkpoint (workspace_id, id),
  CONSTRAINT checkpoint_usage_model_is_not_blank CHECK (model <> ''),
  CONSTRAINT checkpoint_usage_outcome_is_known
    CHECK (outcome IN ('succeeded', 'failed', 'fell_back')),
  CONSTRAINT checkpoint_usage_measurements_are_not_negative
    CHECK (input_tokens >= 0 AND output_tokens >= 0 AND duration_ms >= 0)
);

CREATE INDEX checkpoint_source_resume_idx
  ON checkpoint (workspace_id, source, source_session_ref, created_at DESC)
  WHERE source_session_ref IS NOT NULL;

CREATE INDEX checkpoint_usage_metering_idx ON checkpoint_usage (workspace_id, created_at);

ALTER TABLE checkpoint_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE checkpoint_usage FORCE ROW LEVEL SECURITY;

CREATE POLICY checkpoint_usage_workspace_isolation ON checkpoint_usage
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
