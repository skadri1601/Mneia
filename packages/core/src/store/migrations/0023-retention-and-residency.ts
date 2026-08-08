import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 23,
  name: 'retention-and-residency',
  sql: `
ALTER TABLE workspace ADD COLUMN retention_days INTEGER;
ALTER TABLE workspace ADD COLUMN region TEXT;

ALTER TABLE workspace
  ADD CONSTRAINT workspace_retention_days_is_positive
  CHECK (retention_days IS NULL OR retention_days > 0);

ALTER TABLE workspace
  ADD CONSTRAINT workspace_region_is_not_blank
  CHECK (region IS NULL OR region <> '');

ALTER TABLE context_item ADD COLUMN purge_after TIMESTAMPTZ;

CREATE INDEX context_item_purge_idx
  ON context_item (purge_after)
  WHERE purge_after IS NOT NULL;

CREATE INDEX waitlist_signup_purge_idx
  ON waitlist_signup (approved_at)
  WHERE status = 'approved';
`,
};
