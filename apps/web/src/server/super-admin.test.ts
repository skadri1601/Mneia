import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }));

import { isSuperAdmin, parseSuperAdminSubjects, resolveIsSuperAdmin } from './super-admin.js';

describe('parseSuperAdminSubjects', () => {
  it('reads a comma-separated allowlist and trims each entry', () => {
    expect([...parseSuperAdminSubjects(' user_a , user_b ')]).toEqual(['user_a', 'user_b']);
  });

  it('yields an empty allowlist when the variable is unset or blank', () => {
    expect(parseSuperAdminSubjects(undefined).size).toBe(0);
    expect(parseSuperAdminSubjects('').size).toBe(0);
    expect(parseSuperAdminSubjects(' , , ').size).toBe(0);
  });
});

describe('isSuperAdmin', () => {
  it('admits a subject named in the allowlist', () => {
    expect(isSuperAdmin({ subject: 'user_a', allowed: new Set(['user_a']) })).toBe(true);
  });

  it('refuses a subject the allowlist does not name', () => {
    expect(isSuperAdmin({ subject: 'user_b', allowed: new Set(['user_a']) })).toBe(false);
  });

  it('refuses everyone when the allowlist is empty, rather than admitting everyone', () => {
    expect(isSuperAdmin({ subject: 'user_a', allowed: new Set() })).toBe(false);
  });

  it('refuses a signed-out visitor', () => {
    expect(isSuperAdmin({ subject: null, allowed: new Set(['user_a']) })).toBe(false);
  });

  it('refuses a blank subject even when the allowlist holds a blank entry', () => {
    expect(isSuperAdmin({ subject: '   ', allowed: new Set(['', '   ']) })).toBe(false);
  });
});

describe('resolveIsSuperAdmin', () => {
  it('admits the signed-in subject when the allowlist names it', async () => {
    await expect(
      resolveIsSuperAdmin({
        authenticate: async () => ({ userId: 'user_a' }),
        readAllowlist: () => 'user_a,user_b',
      }),
    ).resolves.toBe(true);
  });

  it('refuses when the allowlist variable is absent from the environment', async () => {
    await expect(
      resolveIsSuperAdmin({
        authenticate: async () => ({ userId: 'user_a' }),
        readAllowlist: () => undefined,
      }),
    ).resolves.toBe(false);
  });

  it('refuses a signed-out visitor regardless of the allowlist', async () => {
    await expect(
      resolveIsSuperAdmin({
        authenticate: async () => ({ userId: null }),
        readAllowlist: () => 'user_a',
      }),
    ).resolves.toBe(false);
  });
});
