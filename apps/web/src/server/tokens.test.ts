import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { TeamMember } from '@mneia/core';
import type { ApiTokenSummary, TokenStore } from './store/token-store.js';
import { assertMayRevokeToken, isExpired, revokeWorkspaceToken, TokenError } from './tokens.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TEAM_ID = '22222222-2222-4222-8222-222222222222';
const MINE = '33333333-3333-4333-8333-333333333333';
const THEIRS = '44444444-4444-4444-8444-444444444444';
const TOKEN_ID = '55555555-5555-4555-8555-555555555555';

const token = (overrides: Partial<ApiTokenSummary> = {}): ApiTokenSummary => ({
  id: TOKEN_ID,
  workspaceId: WORKSPACE_ID,
  actorId: MINE,
  actorDisplayName: 'Ada Lovelace',
  label: 'laptop',
  scopes: ['*'],
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  lastUsedAt: null,
  expiresAt: null,
  issuedByDeviceFlow: true,
  ...overrides,
});

const membership = (role: 'lead' | 'member'): TeamMember => ({
  workspaceId: WORKSPACE_ID,
  teamId: TEAM_ID,
  actorId: MINE,
  role,
  addedAt: new Date('2026-08-01T00:00:00.000Z'),
});

const storeOf = (tokens: readonly ApiTokenSummary[]) => {
  const revoked: string[] = [];
  const store: TokenStore = {
    listTokens: async () => tokens,
    revokeToken: async ({ tokenId }) => {
      revoked.push(tokenId);
      return token({ id: tokenId });
    },
  };
  return { store, revoked };
};

describe('isExpired', () => {
  it('treats a null expiry as live', () => {
    expect(isExpired(token({ expiresAt: null }))).toBe(false);
  });

  it('treats the expiry instant itself as expired', () => {
    const at = new Date('2026-08-10T00:00:00.000Z');
    expect(isExpired(token({ expiresAt: at }), at)).toBe(true);
  });

  it('treats a future expiry as live', () => {
    expect(
      isExpired(
        token({ expiresAt: new Date('2026-08-11T00:00:00.000Z') }),
        new Date('2026-08-10T00:00:00.000Z'),
      ),
    ).toBe(false);
  });
});

describe('assertMayRevokeToken', () => {
  it('lets a member revoke their own token', () => {
    expect(() => assertMayRevokeToken(token(), MINE, membership('member'))).not.toThrow();
  });

  it('lets a lead revoke somebody else’s token', () => {
    expect(() =>
      assertMayRevokeToken(token({ actorId: THEIRS }), MINE, membership('lead')),
    ).not.toThrow();
  });

  it('refuses a member revoking somebody else’s token', () => {
    expect(() =>
      assertMayRevokeToken(token({ actorId: THEIRS }), MINE, membership('member')),
    ).toThrow(TokenError);
  });

  it('names the holder and the caller role when it refuses', () => {
    try {
      assertMayRevokeToken(
        token({ actorId: THEIRS, actorDisplayName: 'Grace Hopper' }),
        MINE,
        membership('member'),
      );
      expect.unreachable('expected a TokenError');
    } catch (error) {
      expect(error).toBeInstanceOf(TokenError);
      expect((error as TokenError).code).toBe('not_permitted');
      expect((error as TokenError).message).toContain('Grace Hopper');
      expect((error as TokenError).message).toContain('member');
    }
  });
});

describe('revokeWorkspaceToken', () => {
  it('revokes a token this account owns', async () => {
    const { store, revoked } = storeOf([token()]);

    await revokeWorkspaceToken({
      workspaceId: WORKSPACE_ID,
      tokenId: TOKEN_ID,
      actorId: MINE,
      membership: membership('member'),
      store,
    });

    expect(revoked).toEqual([TOKEN_ID]);
  });

  it('never reaches the store when the caller may not revoke', async () => {
    const { store, revoked } = storeOf([token({ actorId: THEIRS })]);

    await expect(
      revokeWorkspaceToken({
        workspaceId: WORKSPACE_ID,
        tokenId: TOKEN_ID,
        actorId: MINE,
        membership: membership('member'),
        store,
      }),
    ).rejects.toMatchObject({ code: 'not_permitted' });

    expect(revoked).toEqual([]);
  });

  it('refuses a token id that is not live in this workspace', async () => {
    const { store, revoked } = storeOf([]);

    await expect(
      revokeWorkspaceToken({
        workspaceId: WORKSPACE_ID,
        tokenId: TOKEN_ID,
        actorId: MINE,
        membership: membership('lead'),
        store,
      }),
    ).rejects.toMatchObject({ code: 'token_not_found' });

    expect(revoked).toEqual([]);
  });

  it('refuses a blank token id without asking the store', async () => {
    const listTokens = vi.fn<TokenStore['listTokens']>();
    const store: TokenStore = {
      listTokens,
      revokeToken: async () => token(),
    };

    await expect(
      revokeWorkspaceToken({
        workspaceId: WORKSPACE_ID,
        tokenId: '  ',
        actorId: MINE,
        membership: membership('lead'),
        store,
      }),
    ).rejects.toMatchObject({ code: 'token_not_found' });

    expect(listTokens).not.toHaveBeenCalled();
  });
});
