import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './index.js';

const migration = MIGRATIONS.find(({ version }) => version === 14);
const sql = migration?.sql.replace(/\s+/g, ' ').trim() ?? '';

describe('embedding model provenance migration', () => {
  it('registers version 14', () => {
    expect(migration?.name).toBe('embedding-model-provenance');
  });

  it('adds the column to context_item rather than to workspace', () => {
    expect(sql).toContain('ALTER TABLE context_item ADD COLUMN embedding_model TEXT');
    expect(sql).not.toMatch(/ALTER TABLE workspace/i);
  });

  it('ties the model to the vector in both directions', () => {
    expect(sql).toContain('CHECK ((embedding IS NULL) = (embedding_model IS NULL))');
  });

  it('leaves the column nullable, so rows without a vector stay writable', () => {
    expect(sql).not.toMatch(/embedding_model TEXT NOT NULL/i);
  });

  it('rejects a blank model rather than treating it as an identity', () => {
    expect(sql).toContain("CHECK (embedding_model IS NULL OR embedding_model <> '')");
  });
});
