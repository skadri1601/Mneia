import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 33,
  name: 'context-item-verification-due',
  sql: `
CREATE INDEX context_item_verification_due_idx
  ON context_item (workspace_id, project_id, (COALESCE(last_verified_at, asserted_at)))
  WHERE status = 'active' AND valid_to IS NULL AND decay_after IS NOT NULL;
`,
};
