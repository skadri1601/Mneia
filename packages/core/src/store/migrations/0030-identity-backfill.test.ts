import { describe, expect, it } from 'vitest';
import { MIGRATIONS } from './index.js';

const migration = MIGRATIONS.find(({ version }) => version === 30);
const sql = migration?.sql.replace(/\s+/g, ' ').trim() ?? '';

describe('identity backfill migration', () => {
  it('registers version 30', () => {
    expect(migration?.name).toBe('identity-backfill');
  });

  it('mints an identity only for a human actor that has none', () => {
    expect(sql).toMatch(/INSERT INTO identity \(id, subject\)/i);
    expect(sql).toMatch(/actor\.identity_id IS NULL/i);
    expect(sql).toMatch(/actor\.external_ref IS NOT NULL AND actor\.external_ref <> ''/i);
  });

  it('never mints a second identity for a subject that already has one', () => {
    expect(sql).toMatch(
      /WHERE NOT EXISTS \( SELECT 1 FROM identity WHERE identity\.subject = missing\.external_ref \)/i,
    );
  });

  it('leaves an already-linked actor alone', () => {
    expect(sql).toMatch(/UPDATE actor SET identity_id = identity\.id/i);
    expect(sql).toMatch(
      /AND actor\.identity_id IS NULL AND actor\.external_ref = identity\.subject/i,
    );
  });

  it('makes the earliest human in a workspace its owner and other leads admins', () => {
    expect(sql).toMatch(/WHEN actor\.id = founder\.id THEN 'owner'::workspace_role/i);
    expect(sql).toMatch(/WHEN membership\.role = 'lead'::team_role THEN 'admin'::workspace_role/i);
    expect(sql).toMatch(/ELSE 'member'::workspace_role/i);
  });

  it('never overwrites a membership row the invitation path already wrote', () => {
    expect(sql).toMatch(/ON CONFLICT \(workspace_id, identity_id\) DO NOTHING/i);
  });

  it('refuses a signed-in human actor that carries no identity', () => {
    expect(sql).toMatch(
      /ADD CONSTRAINT actor_identified_human_carries_an_identity CHECK \( kind <> 'human'::actor_kind OR external_ref IS NULL OR external_ref = '' OR identity_id IS NOT NULL \)/i,
    );
  });

  it('leaves agent actors and fixture humans without an external_ref unconstrained', () => {
    expect(sql).toMatch(/kind <> 'human'::actor_kind OR external_ref IS NULL/i);
  });
});
