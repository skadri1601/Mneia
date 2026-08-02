import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './index.js';

const migration = MIGRATIONS.find(({ version }) => version === 9);
const sql = migration?.sql.replace(/\s+/g, ' ').trim() ?? '';

describe('project management migration', () => {
  it('registers version 9', () => {
    expect(migration?.name).toBe('project-management');
  });

  it('adds project lifecycle columns and backfills display names', () => {
    expect(sql).toMatch(
      /ALTER TABLE project ADD COLUMN display_name TEXT, ADD COLUMN archived_at TIMESTAMPTZ;/i,
    );
    expect(sql).toMatch(/UPDATE project SET display_name = slug WHERE display_name IS NULL;/i);
    expect(sql).toMatch(/ALTER TABLE project ALTER COLUMN display_name SET NOT NULL;/i);
  });

  it('derives display names from slugs for legacy inserts', () => {
    expect(sql).toMatch(/IF NEW\.display_name IS NULL THEN NEW\.display_name := NEW\.slug;/i);
    expect(sql).toMatch(
      /CREATE TRIGGER project_display_name_default BEFORE INSERT ON project FOR EACH ROW EXECUTE FUNCTION mneia_project_write_guard\(\);/i,
    );
  });

  it('keeps the repository binding slug immutable', () => {
    expect(sql).toMatch(/IF NEW\.slug IS DISTINCT FROM OLD\.slug THEN RAISE EXCEPTION/i);
    expect(sql).toMatch(
      /CREATE TRIGGER project_slug_immutable BEFORE UPDATE OF slug ON project FOR EACH ROW EXECUTE FUNCTION mneia_project_write_guard\(\);/i,
    );
  });

  it('indexes deterministic active-project lists within a workspace', () => {
    expect(sql).toMatch(
      /CREATE INDEX project_active_workspace_display_name_idx ON project \(workspace_id, display_name, id\) WHERE archived_at IS NULL;/i,
    );
  });
});
