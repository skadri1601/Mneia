import { describe, expect, it } from 'vitest';
import {
  API_TOKEN_HASH_SETTING,
  DEVICE_AUTHORIZATION_STATUSES,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
} from '../../index.js';
import { MIGRATIONS } from './index.js';

const migration = MIGRATIONS.find(({ version }) => version === 12);
const sql = migration?.sql.replace(/\s+/g, ' ').trim() ?? '';

const policy = (name: string): string => {
  const match = new RegExp(
    `CREATE POLICY ${name} ON \\w+([\\s\\S]*?);(?= CREATE| ALTER|$)`,
    'i',
  ).exec(sql);
  return match?.[0] ?? '';
};

describe('device authorization migration', () => {
  it('registers version 12 and the three secret settings', () => {
    expect(migration?.name).toBe('device-authorization');
    expect(DEVICE_CODE_HASH_SETTING).toBe('mneia.device_code_hash');
    expect(DEVICE_USER_CODE_SETTING).toBe('mneia.device_user_code');
    expect(API_TOKEN_HASH_SETTING).toBe('mneia.api_token_hash');
    expect(DEVICE_AUTHORIZATION_STATUSES).toEqual(['pending', 'approved', 'denied', 'redeemed']);
  });

  it('forces row level security on every table it creates', () => {
    for (const table of ['device_authorization', 'api_token', 'device_approval_attempt']) {
      expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
  });

  it('models status as a checked text column rather than an enum', () => {
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'pending' CHECK \(status IN \(/i);
    expect(sql).not.toMatch(/CREATE TYPE \w*device\w*/i);
  });

  it('declares every policy exactly once', () => {
    const names = [
      'device_authorization_start',
      'device_authorization_poll',
      'device_authorization_user_code_lookup',
      'device_authorization_workspace_isolation',
      'device_authorization_claim',
      'device_authorization_redemption',
      'api_token_workspace_isolation',
      'api_token_bearer_lookup',
      'device_approval_attempt_workspace_isolation',
    ];

    for (const name of names) {
      expect(sql.match(new RegExp(`CREATE POLICY ${name}\\b`, 'gi')), name).toHaveLength(1);
    }
  });

  it('never grants a write through a secret-keyed policy', () => {
    for (const name of [
      'device_authorization_poll',
      'device_authorization_user_code_lookup',
      'device_authorization_workspace_isolation',
      'api_token_bearer_lookup',
    ]) {
      expect(policy(name), name).toMatch(/FOR SELECT/i);
      expect(policy(name), name).not.toMatch(/FOR (?:ALL|INSERT|UPDATE|DELETE)/i);
    }
  });

  it('pins a claim to the deciding workspace, so no workspace can claim a code into another', () => {
    const claim = policy('device_authorization_claim');

    expect(claim).toMatch(/FOR UPDATE/i);
    expect(claim).toMatch(/WITH CHECK/i);

    const withCheck = claim.slice(claim.search(/WITH CHECK/i));
    expect(withCheck).toContain(
      `claimed_workspace_id = NULLIF(current_setting('mneia.workspace_id', true), '')::uuid`,
    );
    expect(withCheck).toMatch(/status IN \('approved', 'denied'\)/i);
  });

  it('stops a device code holder from approving their own authorization', () => {
    const claim = policy('device_authorization_claim');
    const redemption = policy('device_authorization_redemption');

    expect(claim).not.toContain('device_code_hash');
    expect(redemption.slice(redemption.search(/WITH CHECK/i))).toMatch(/status = 'redeemed'/i);
  });

  it('gives every update policy an explicit WITH CHECK', () => {
    for (const name of ['device_authorization_claim', 'device_authorization_redemption']) {
      expect(policy(name), name).toMatch(/USING[\s\S]*WITH CHECK/i);
    }
  });

  it('contains secret-keyed reads to sessions that have no workspace', () => {
    const blank = `NULLIF(current_setting('mneia.workspace_id', true), '') IS NULL`;

    expect(policy('device_authorization_start')).toContain(blank);
    expect(policy('device_authorization_poll')).toContain(blank);
    expect(policy('api_token_bearer_lookup')).toContain(blank);
  });

  it('carries token liveness in the policy rather than leaving it to a query', () => {
    const bearer = policy('api_token_bearer_lookup');

    expect(bearer).toMatch(/revoked_at IS NULL/i);
    expect(bearer).toMatch(/expires_at IS NULL OR expires_at > now\(\)/i);
  });

  it('derives expiry rather than storing it as a status', () => {
    expect(DEVICE_AUTHORIZATION_STATUSES).not.toContain('expired');
    expect(policy('device_authorization_user_code_lookup')).toMatch(/expires_at > now\(\)/i);
    expect(policy('device_authorization_claim')).toMatch(/expires_at > now\(\)/i);
  });

  it('guards the status transitions with a trigger', () => {
    expect(sql).toContain('CREATE FUNCTION mneia_device_authorization_write_guard()');
    expect(sql).toContain('CREATE TRIGGER device_authorization_transition_guard');
    expect(sql).toMatch(/BEFORE UPDATE ON device_authorization/i);
    expect(sql).toMatch(/secrets and lifetime are immutable/i);
    expect(sql).toMatch(/cannot move it to another workspace/i);
  });

  it('uniquely indexes both secrets and the token hash', () => {
    expect(sql).toContain(
      'CREATE UNIQUE INDEX device_authorization_device_code_hash_key ON device_authorization (device_code_hash)',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX device_authorization_user_code_key ON device_authorization (user_code)',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX api_token_token_hash_key ON api_token (token_hash)');
  });

  it('makes a partial claim unrepresentable', () => {
    expect(sql).toMatch(/device_authorization_claim_is_whole/i);
    expect(sql).toMatch(/device_authorization_claim_matches_status/i);
    expect(sql).toMatch(/device_authorization_redeemed_at_matches_status/i);
  });
});
