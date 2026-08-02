import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 8,
  name: 'conflict-pair-constraints',
  sql: `
ALTER TABLE conflict
  ADD CONSTRAINT conflict_items_distinct CHECK (item_a <> item_b);

CREATE UNIQUE INDEX conflict_open_pair_unique
  ON conflict (workspace_id, project_id, LEAST(item_a, item_b), GREATEST(item_a, item_b))
  WHERE resolved_at IS NULL;
`,
};
