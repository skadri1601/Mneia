import 'server-only';

export type TokenErrorCode = 'token_not_found' | 'not_permitted' | 'corrupt_token';

export class TokenError extends Error {
  readonly code: TokenErrorCode;

  constructor(code: TokenErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TokenError';
    this.code = code;
  }
}

export interface ApiTokenSummary {
  readonly id: string;
  readonly workspaceId: string;
  readonly actorId: string;
  readonly actorDisplayName: string;
  readonly label: string;
  readonly scopes: readonly string[];
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
  readonly expiresAt: Date | null;
  readonly issuedByDeviceFlow: boolean;
}

export interface ListTokensInput {
  readonly workspaceId: string;
}

export interface RevokeTokenInput {
  readonly workspaceId: string;
  readonly tokenId: string;
}

export interface TokenStore {
  listTokens(input: ListTokensInput): Promise<readonly ApiTokenSummary[]>;
  revokeToken(input: RevokeTokenInput): Promise<ApiTokenSummary>;
}
