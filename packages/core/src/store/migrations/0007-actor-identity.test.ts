import { describe, expect, it } from 'vitest';
import { IDENTITY_SUBJECT_SETTING } from '../../index.js';
import { MIGRATIONS } from './index.js';

const migration = MIGRATIONS.find(({ version }) => version === 7);
const sql = migration?.sql.replace(/\s+/g, ' ').trim() ?? '';

describe('actor identity migration', () => {
  it('registers version 7 and the identity subject setting', () => {
    expect(migration?.name).toBe('actor-identity');
    expect(IDENTITY_SUBJECT_SETTING).toBe('mneia.identity_subject');
  });

  it('uniquely indexes non-null external references for human actors', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX actor_human_external_ref_unique ON actor \(external_ref\) WHERE external_ref IS NOT NULL AND kind = 'human'::actor_kind;/i,
    );
  });

  it('allows only pre-workspace human identity lookup by the transaction subject', () => {
    expect(sql).toMatch(
      /CREATE POLICY actor_identity_lookup ON actor AS PERMISSIVE FOR SELECT USING \(\s*kind = 'human'::actor_kind AND external_ref = NULLIF\(current_setting\('mneia\.identity_subject', true\), ''\) AND NULLIF\(current_setting\('mneia\.workspace_id', true\), ''\) IS NULL\s*\);/i,
    );
    expect(sql.match(/CREATE POLICY actor_identity_lookup/gi)).toHaveLength(1);
    expect(sql).not.toMatch(
      /CREATE POLICY actor_identity_lookup[\s\S]*?FOR (?:ALL|INSERT|UPDATE|DELETE)/i,
    );
  });
});
