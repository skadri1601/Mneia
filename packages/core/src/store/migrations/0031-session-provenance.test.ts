import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './index.js';

describe('session provenance migration', () => {
  it('adds every client provenance field as an additive nullable column', () => {
    const migration = MIGRATIONS.find((candidate) => candidate.version === 31);

    expect(migration?.name).toBe('session-provenance');
    expect(migration?.sql).toMatch(/ALTER TABLE session/);
    for (const column of [
      'client_name',
      'client_version',
      'client_session_ref',
      'client_session_name',
      'client_session_url',
    ]) {
      expect(migration?.sql).toMatch(new RegExp(`ADD COLUMN ${column} TEXT`));
      expect(migration?.sql).not.toMatch(new RegExp(`ADD COLUMN ${column} TEXT NOT NULL`));
    }
  });
});
