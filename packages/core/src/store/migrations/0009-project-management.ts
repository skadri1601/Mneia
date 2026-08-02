import type { Migration } from './migration.js';

export const migration: Migration = {
  version: 9,
  name: 'project-management',
  sql: `
ALTER TABLE project
  ADD COLUMN display_name TEXT,
  ADD COLUMN archived_at TIMESTAMPTZ;

UPDATE project
  SET display_name = slug
  WHERE display_name IS NULL;

ALTER TABLE project
  ALTER COLUMN display_name SET NOT NULL;

CREATE FUNCTION mneia_project_write_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.display_name IS NULL THEN
      NEW.display_name := NEW.slug;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'project slug is immutable'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_display_name_default
  BEFORE INSERT ON project
  FOR EACH ROW
  EXECUTE FUNCTION mneia_project_write_guard();

CREATE TRIGGER project_slug_immutable
  BEFORE UPDATE OF slug ON project
  FOR EACH ROW
  EXECUTE FUNCTION mneia_project_write_guard();

CREATE INDEX project_active_workspace_display_name_idx
  ON project (workspace_id, display_name, id)
  WHERE archived_at IS NULL;
`,
};
