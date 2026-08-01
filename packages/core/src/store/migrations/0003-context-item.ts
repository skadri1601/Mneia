import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 3,
  name: 'context-item',
  sql: `
CREATE TYPE item_kind AS ENUM (
  'decision', 'constraint', 'open_question', 'fact', 'artifact_ref'
);

CREATE TYPE item_status AS ENUM ('active', 'superseded', 'disputed', 'retired');

CREATE TYPE access_scope AS ENUM (
  'private', 'project', 'team', 'workspace', 'restricted'
);

CREATE TABLE context_item (
  id                UUID PRIMARY KEY,
  workspace_id      UUID NOT NULL REFERENCES workspace(id),
  project_id        UUID NOT NULL,
  kind              item_kind NOT NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  status            item_status NOT NULL DEFAULT 'active',

  asserted_by       UUID NOT NULL,
  asserted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_session_id UUID,
  source_ref        TEXT,

  confidence        REAL NOT NULL DEFAULT 0.5
                      CHECK (confidence >= 0 AND confidence <= 1),
  human_confirmed   BOOLEAN NOT NULL DEFAULT false,
  load_bearing      BOOLEAN NOT NULL DEFAULT false,
  last_verified_at  TIMESTAMPTZ,
  decay_after       INTERVAL,

  valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to          TIMESTAMPTZ,
  supersedes_id     UUID,
  superseded_by_id  UUID,

  access_scope      access_scope NOT NULL DEFAULT 'project',
  embedding         VECTOR(1536),

  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES project (workspace_id, id),
  FOREIGN KEY (workspace_id, asserted_by) REFERENCES actor (workspace_id, id),
  FOREIGN KEY (workspace_id, source_session_id) REFERENCES session (workspace_id, id),
  FOREIGN KEY (workspace_id, supersedes_id) REFERENCES context_item (workspace_id, id),
  FOREIGN KEY (workspace_id, superseded_by_id) REFERENCES context_item (workspace_id, id)
);

CREATE INDEX ON context_item (project_id, status, kind);
CREATE INDEX ON context_item USING ivfflat (embedding vector_cosine_ops);

ALTER TABLE context_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_item FORCE ROW LEVEL SECURITY;
CREATE POLICY context_item_workspace_isolation ON context_item
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
