import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 18,
  name: 'context-item-embedding',
  sql: `
CREATE TABLE context_item_embedding (
  workspace_id  UUID NOT NULL REFERENCES workspace (id),
  item_id       UUID NOT NULL,
  model         TEXT NOT NULL,
  dim           INTEGER NOT NULL,
  embedding     VECTOR(1536) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, model),
  FOREIGN KEY (workspace_id, item_id)
    REFERENCES context_item (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT context_item_embedding_model_is_not_blank CHECK (model <> ''),
  CONSTRAINT context_item_embedding_dim_matches CHECK (dim = 1536)
);

CREATE INDEX context_item_embedding_workspace_item_idx
  ON context_item_embedding (workspace_id, item_id);

CREATE INDEX context_item_embedding_vector_idx
  ON context_item_embedding USING hnsw (embedding vector_cosine_ops);

INSERT INTO context_item_embedding (workspace_id, item_id, model, dim, embedding)
SELECT workspace_id, id, embedding_model, 1536, embedding
FROM context_item
WHERE embedding IS NOT NULL AND embedding_model IS NOT NULL;

DROP INDEX context_item_embedding_idx;

ALTER TABLE context_item DROP CONSTRAINT context_item_embedding_model_present;
ALTER TABLE context_item DROP CONSTRAINT context_item_embedding_model_not_blank;
ALTER TABLE context_item DROP COLUMN embedding_model;
ALTER TABLE context_item DROP COLUMN embedding;

ALTER TABLE context_item_embedding ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_item_embedding FORCE ROW LEVEL SECURITY;

CREATE POLICY context_item_embedding_workspace_isolation ON context_item_embedding
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
