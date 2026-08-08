import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 21,
  name: 'decision-rationale',
  sql: `
ALTER TABLE conflict ADD COLUMN rationale TEXT;

UPDATE conflict
   SET rationale = 'resolved before rationale capture landed (MNE-134)'
 WHERE resolved_at IS NOT NULL AND rationale IS NULL;

ALTER TABLE conflict DROP CONSTRAINT conflict_resolution_is_whole;

ALTER TABLE conflict
  ADD CONSTRAINT conflict_resolution_is_whole
  CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL AND rationale IS NULL)
    OR (
      resolved_at IS NOT NULL
      AND resolved_by IS NOT NULL
      AND resolution IS NOT NULL
      AND rationale IS NOT NULL
      AND rationale <> ''
    )
  );

ALTER TABLE context_item ADD COLUMN supersede_reason TEXT;

ALTER TABLE context_item
  ADD CONSTRAINT context_item_supersede_reason_needs_a_predecessor
  CHECK (supersede_reason IS NULL OR (supersedes_id IS NOT NULL AND supersede_reason <> ''));
`,
};
