import { describe, expect, it } from 'vitest';
import { INVITATION_EMAIL_SETTING, INVITATION_TOKEN_HASH_SETTING } from '../../index.js';
import { MIGRATIONS } from './index.js';

const migration = MIGRATIONS.find(({ version }) => version === 16);
const sql = migration?.sql.replace(/\s+/g, ' ').trim() ?? '';

const policy = (name: string): string => {
  const match = new RegExp(
    `CREATE POLICY ${name} ON \\w+([\\s\\S]*?);(?= CREATE| ALTER|$)`,
    'i',
  ).exec(sql);
  return match?.[0] ?? '';
};

describe('workspace invitation migration', () => {
  it('registers version 16 and the two lookup settings', () => {
    expect(migration?.name).toBe('workspace-invitation');
    expect(INVITATION_TOKEN_HASH_SETTING).toBe('mneia.invitation_token_hash');
    expect(INVITATION_EMAIL_SETTING).toBe('mneia.invitation_email');
  });

  it('forces row level security on the table it creates', () => {
    expect(sql).toContain('ALTER TABLE workspace_invitation ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('ALTER TABLE workspace_invitation FORCE ROW LEVEL SECURITY');
  });

  it('stores a token hash and never the token', () => {
    expect(sql).toMatch(/token_hash TEXT NOT NULL/i);
    expect(sql).not.toMatch(/\btoken TEXT/i);
    expect(sql).toContain('CREATE UNIQUE INDEX workspace_invitation_token_hash_key');
  });

  it('carries workspace_id and keys every foreign key on it', () => {
    expect(sql).toMatch(/workspace_id UUID NOT NULL REFERENCES workspace \(id\)/i);
    for (const reference of [
      'FOREIGN KEY (workspace_id, team_id) REFERENCES team (workspace_id, id)',
      'FOREIGN KEY (workspace_id, invited_by) REFERENCES actor (workspace_id, id)',
      'FOREIGN KEY (workspace_id, accepted_actor_id) REFERENCES actor (workspace_id, id)',
    ]) {
      expect(sql).toContain(reference);
    }
  });

  it('allows one live invitation per address per workspace', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX workspace_invitation_one_live_per_email ON workspace_invitation (workspace_id, invited_email) WHERE accepted_at IS NULL AND revoked_at IS NULL',
    );
  });

  it('declares every policy exactly once', () => {
    for (const name of [
      'workspace_invitation_workspace_isolation',
      'workspace_invitation_token_lookup',
      'workspace_invitation_email_lookup',
    ]) {
      expect(sql.match(new RegExp(`CREATE POLICY ${name}\\b`, 'gi')), name).toHaveLength(1);
    }
  });

  it('keys workspace isolation on the workspace GUC for reads and writes', () => {
    const isolation = policy('workspace_invitation_workspace_isolation');
    expect(isolation).toContain(
      `USING (workspace_id = NULLIF(current_setting('mneia.workspace_id', true), '')::uuid)`,
    );
    expect(isolation).toContain(
      `WITH CHECK (workspace_id = NULLIF(current_setting('mneia.workspace_id', true), '')::uuid)`,
    );
  });

  it.each(['workspace_invitation_token_lookup', 'workspace_invitation_email_lookup'])(
    'never grants a write through %s, and only outside a workspace scope',
    (name) => {
      const declaration = policy(name);
      expect(declaration).toContain('FOR SELECT');
      expect(declaration).not.toContain('WITH CHECK');
      expect(declaration).toContain(
        `NULLIF(current_setting('mneia.workspace_id', true), '') IS NULL`,
      );
      expect(declaration).toContain('accepted_at IS NULL');
      expect(declaration).toContain('revoked_at IS NULL');
      expect(declaration).toContain('expires_at > now()');
    },
  );

  it('makes an invitation immutable apart from being settled once', () => {
    expect(sql).toContain('CREATE TRIGGER workspace_invitation_transition_guard');
    expect(sql).toContain(
      'a workspace invitation is immutable apart from being accepted or revoked',
    );
    expect(sql).toContain('a workspace invitation can only be settled once');
    expect(sql).toContain('an expired workspace invitation cannot be accepted');
  });

  it('refuses an unnormalized email address at the column', () => {
    expect(sql).toContain(
      "CHECK (invited_email = lower(btrim(invited_email)) AND position('@' IN invited_email) > 1)",
    );
  });
});
