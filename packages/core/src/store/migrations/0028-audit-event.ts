import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 28,
  name: 'audit-event',
  sql: `
CREATE TABLE audit_event (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace (id),
  actor_id      UUID,
  action        TEXT NOT NULL,
  target_kind   TEXT NOT NULL,
  target_id     UUID,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (workspace_id, actor_id) REFERENCES actor (workspace_id, id),
  CONSTRAINT audit_event_action_is_not_blank CHECK (action <> ''),
  CONSTRAINT audit_event_target_kind_is_not_blank CHECK (target_kind <> ''),
  CONSTRAINT audit_event_metadata_is_an_object CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX audit_event_workspace_idx ON audit_event (workspace_id, occurred_at DESC);
CREATE INDEX audit_event_target_idx ON audit_event (workspace_id, target_kind, target_id);

CREATE FUNCTION mneia_audit_event_is_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW
  EXECUTE FUNCTION mneia_audit_event_is_append_only();

ALTER TABLE audit_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_event FORCE ROW LEVEL SECURITY;

CREATE POLICY audit_event_workspace_isolation ON audit_event
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
