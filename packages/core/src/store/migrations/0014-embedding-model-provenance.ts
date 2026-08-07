import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 14,
  name: 'embedding-model-provenance',
  sql: `
ALTER TABLE context_item ADD COLUMN embedding_model TEXT;

ALTER TABLE context_item
  ADD CONSTRAINT context_item_embedding_model_not_blank
  CHECK (embedding_model IS NULL OR embedding_model <> '');

ALTER TABLE context_item
  ADD CONSTRAINT context_item_embedding_model_present
  CHECK ((embedding IS NULL) = (embedding_model IS NULL));
`,
};
