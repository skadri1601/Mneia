import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

const isolate = (table: string): string => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY ${table}_workspace_isolation ON ${table}
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`;

export const migration: Migration = {
  version: 6,
  name: 'checkpoint-handoff',
  sql: `
CREATE TYPE checkpoint_trigger AS ENUM (
  'task_boundary', 'day_boundary', 'manual', 'pre_compaction'
);

CREATE TABLE checkpoint (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  project_id    UUID NOT NULL,
  session_id    UUID,
  actor_id      UUID NOT NULL,
  trigger       checkpoint_trigger NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary       TEXT,

  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES project (workspace_id, id),
  FOREIGN KEY (workspace_id, session_id) REFERENCES session (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES actor (workspace_id, id)
);

CREATE TYPE checkpoint_action AS ENUM (
  'created', 'updated', 'superseded', 'rejected'
);

CREATE TABLE checkpoint_item (
  workspace_id   UUID NOT NULL REFERENCES workspace(id),
  checkpoint_id  UUID NOT NULL,
  item_id        UUID NOT NULL,
  action         checkpoint_action NOT NULL,

  PRIMARY KEY (checkpoint_id, item_id),
  FOREIGN KEY (workspace_id, checkpoint_id) REFERENCES checkpoint (workspace_id, id),
  FOREIGN KEY (workspace_id, item_id) REFERENCES context_item (workspace_id, id)
);

CREATE TABLE handoff (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  project_id    UUID NOT NULL,
  from_actor    UUID NOT NULL,
  to_actor      UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at   TIMESTAMPTZ,
  next_action   TEXT NOT NULL,
  rendered      TEXT NOT NULL,

  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES project (workspace_id, id),
  FOREIGN KEY (workspace_id, from_actor) REFERENCES actor (workspace_id, id),
  FOREIGN KEY (workspace_id, to_actor) REFERENCES actor (workspace_id, id)
);

CREATE TYPE conflict_resolution AS ENUM (
  'a_wins', 'b_wins', 'merged', 'both_retired'
);

CREATE TABLE conflict (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  project_id    UUID NOT NULL,
  item_a        UUID NOT NULL,
  item_b        UUID NOT NULL,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID,
  resolution    conflict_resolution,

  CONSTRAINT conflict_resolution_is_whole CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL AND resolution IS NULL)
    OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution IS NOT NULL)
  ),

  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES project (workspace_id, id),
  FOREIGN KEY (workspace_id, item_a) REFERENCES context_item (workspace_id, id),
  FOREIGN KEY (workspace_id, item_b) REFERENCES context_item (workspace_id, id),
  FOREIGN KEY (workspace_id, resolved_by) REFERENCES actor (workspace_id, id)
);

CREATE INDEX ON checkpoint (workspace_id, project_id, created_at DESC);
CREATE INDEX ON checkpoint (workspace_id, session_id);
CREATE INDEX ON checkpoint_item (item_id);
CREATE INDEX ON handoff (workspace_id, project_id);
CREATE INDEX ON handoff (workspace_id, to_actor) WHERE received_at IS NULL;
CREATE INDEX ON conflict (workspace_id, project_id, detected_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX ON conflict (workspace_id, item_a);
CREATE INDEX ON conflict (workspace_id, item_b);
${isolate('checkpoint')}${isolate('checkpoint_item')}${isolate('handoff')}${isolate('conflict')}`,
};
