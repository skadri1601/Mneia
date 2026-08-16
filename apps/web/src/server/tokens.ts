import 'server-only';

import type { TeamMember } from '@mneia/core';
import type { ApiTokenSummary, TokenStore } from './store/token-store.js';
import { TokenError } from './store/token-store.js';

export type { ApiTokenSummary, TokenErrorCode } from './store/token-store.js';
export { TokenError };

export const isExpired = (token: ApiTokenSummary, now: Date = new Date()): boolean =>
  token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime();

export const assertMayRevokeToken = (
  token: ApiTokenSummary,
  actorId: string,
  membership: TeamMember,
): void => {
  if (token.actorId === actorId) return;
  if (membership.role === 'lead') return;

  throw new TokenError(
    'not_permitted',
    `Expected the token to belong to this account or the account to be a workspace lead; it belongs to ${token.actorDisplayName} and this account is a ${membership.role} — ask a lead to revoke it`,
  );
};

export interface ListWorkspaceTokensRequest {
  readonly workspaceId: string;
  readonly store: TokenStore;
}

export const listWorkspaceTokens = async ({
  workspaceId,
  store,
}: ListWorkspaceTokensRequest): Promise<readonly ApiTokenSummary[]> =>
  store.listTokens({ workspaceId });

export interface RevokeWorkspaceTokenRequest {
  readonly workspaceId: string;
  readonly tokenId: string;
  readonly actorId: string;
  readonly membership: TeamMember;
  readonly store: TokenStore;
}

export const revokeWorkspaceToken = async ({
  workspaceId,
  tokenId,
  actorId,
  membership,
  store,
}: RevokeWorkspaceTokenRequest): Promise<ApiTokenSummary> => {
  if (tokenId.trim().length === 0) {
    throw new TokenError('token_not_found', 'Expected a token id to revoke; received none');
  }

  const tokens = await store.listTokens({ workspaceId });
  const token = tokens.find((candidate) => candidate.id === tokenId);
  if (token === undefined) {
    throw new TokenError(
      'token_not_found',
      `Expected a live token ${tokenId} in this workspace; it was already revoked or never existed`,
    );
  }

  assertMayRevokeToken(token, actorId, membership);

  return store.revokeToken({ workspaceId, tokenId });
};
