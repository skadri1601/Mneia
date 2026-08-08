import type { Migration } from './migration.js';

const WORKSPACE_GUC = `NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`;

export const migration: Migration = {
  version: 19,
  name: 'telemetry-event',
  sql: `
CREATE TABLE telemetry_event (
  id            UUID NOT NULL,
  workspace_id  UUID NOT NULL REFERENCES workspace (id),
  project_id    UUID,
  actor_id      UUID,
  session_id    UUID,
  name          TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at),
  CONSTRAINT telemetry_event_name_is_not_blank CHECK (name <> ''),
  CONSTRAINT telemetry_event_payload_is_an_object CHECK (jsonb_typeof(payload) = 'object')
) PARTITION BY RANGE (occurred_at);

CREATE INDEX telemetry_event_metering_idx
  ON telemetry_event (workspace_id, name, occurred_at);

CREATE INDEX telemetry_event_project_idx
  ON telemetry_event (workspace_id, project_id, occurred_at);

CREATE TABLE telemetry_event_default PARTITION OF telemetry_event DEFAULT;

CREATE FUNCTION mneia_ensure_telemetry_partition(month DATE)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  start_at DATE := date_trunc('month', month)::date;
  end_at   DATE := (date_trunc('month', month) + interval '1 month')::date;
  part     TEXT := 'telemetry_event_' || to_char(start_at, 'YYYYMM');
BEGIN
  IF to_regclass('public.' || part) IS NOT NULL THEN
    RETURN part;
  END IF;

  EXECUTE format(
    'CREATE TABLE %I PARTITION OF telemetry_event FOR VALUES FROM (%L) TO (%L)',
    part, start_at, end_at
  );

  RETURN part;
END;
$$;

ALTER TABLE telemetry_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_event FORCE ROW LEVEL SECURITY;

CREATE POLICY telemetry_event_workspace_isolation ON telemetry_event
  AS PERMISSIVE
  FOR ALL
  USING (workspace_id = ${WORKSPACE_GUC})
  WITH CHECK (workspace_id = ${WORKSPACE_GUC});
`,
};
