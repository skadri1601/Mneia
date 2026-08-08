import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 20,
  name: 'checkpoint-cost-and-review',
  sql: `
CREATE TYPE checkpoint_review_state AS ENUM ('pending', 'reviewed', 'auto_accepted');

ALTER TABLE checkpoint
  ADD COLUMN review_state checkpoint_review_state NOT NULL DEFAULT 'pending',
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN reviewed_by UUID,
  ADD COLUMN extraction_model TEXT,
  ADD COLUMN input_tokens INTEGER,
  ADD COLUMN output_tokens INTEGER,
  ADD COLUMN cost_micros BIGINT,
  ADD COLUMN extraction_duration_ms INTEGER;

ALTER TABLE checkpoint
  ADD CONSTRAINT checkpoint_workspace_id_reviewed_by_fkey
  FOREIGN KEY (workspace_id, reviewed_by) REFERENCES actor (workspace_id, id);

ALTER TABLE checkpoint
  ADD CONSTRAINT checkpoint_review_is_whole
  CHECK ((review_state = 'reviewed') = (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL));

ALTER TABLE checkpoint
  ADD CONSTRAINT checkpoint_extraction_model_is_not_blank
  CHECK (extraction_model IS NULL OR extraction_model <> '');

ALTER TABLE checkpoint
  ADD CONSTRAINT checkpoint_token_counts_are_not_negative
  CHECK (
    (input_tokens IS NULL OR input_tokens >= 0)
    AND (output_tokens IS NULL OR output_tokens >= 0)
    AND (cost_micros IS NULL OR cost_micros >= 0)
    AND (extraction_duration_ms IS NULL OR extraction_duration_ms >= 0)
  );

CREATE INDEX checkpoint_pending_review_idx
  ON checkpoint (workspace_id, project_id, created_at DESC)
  WHERE review_state = 'pending';
`,
};
