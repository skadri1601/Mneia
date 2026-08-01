import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

const isolate = (table: string, column = 'workspace_id'): string => `
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
CREATE POLICY ${table}_workspace_isolation ON ${table}
  USING (${column} = ${WORKSPACE_GUC})
  WITH CHECK (${column} = ${WORKSPACE_GUC});
`;

export const migration: Migration = {
  version: 2,
  name: 'core-entities',
  sql: `
CREATE TABLE workspace (
  id                    UUID PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  plan                  TEXT NOT NULL DEFAULT 'solo'
                          CHECK (plan IN ('solo', 'team', 'enterprise')),
  billing_status        TEXT NOT NULL DEFAULT 'active'
                          CHECK (billing_status IN ('active', 'trialing', 'past_due', 'canceled')),
  billing_customer_ref  TEXT,
  seats_purchased       INTEGER CHECK (seats_purchased IS NULL OR seats_purchased > 0),
  checkpoint_allowance  INTEGER CHECK (checkpoint_allowance IS NULL OR checkpoint_allowance >= 0),
  trial_ends_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE actor_kind AS ENUM ('human', 'agent');

CREATE TABLE actor (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  kind          actor_kind NOT NULL,
  display_name  TEXT NOT NULL,
  external_ref  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE TYPE team_function AS ENUM (
  'engineering', 'product', 'design', 'sales', 'marketing',
  'support', 'success', 'operations', 'finance', 'other'
);

CREATE TABLE team (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  slug          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  function      team_function NOT NULL DEFAULT 'engineering',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  UNIQUE (workspace_id, id)
);

CREATE TYPE team_role AS ENUM ('lead', 'member');

CREATE TABLE team_member (
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  team_id       UUID NOT NULL,
  actor_id      UUID NOT NULL,
  role          team_role NOT NULL DEFAULT 'member',
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, actor_id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES team (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES actor (workspace_id, id)
);

CREATE TABLE project (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  team_id       UUID,
  slug          TEXT NOT NULL,
  repo_url      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, team_id) REFERENCES team (workspace_id, id)
);

CREATE TABLE session (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  project_id    UUID NOT NULL,
  actor_id      UUID NOT NULL,
  tool          TEXT,
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, project_id) REFERENCES project (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_id) REFERENCES actor (workspace_id, id)
);

CREATE INDEX ON team_member (actor_id);
CREATE INDEX ON project (workspace_id, team_id);
CREATE INDEX ON session (workspace_id, project_id);
CREATE INDEX ON session (workspace_id, actor_id);
${isolate('workspace', 'id')}${isolate('actor')}${isolate('team')}${isolate('team_member')}${isolate('project')}${isolate('session')}`,
};
