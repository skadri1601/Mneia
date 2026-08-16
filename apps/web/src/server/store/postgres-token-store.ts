import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  WORKSPACE_SETTING,
} from '@mneia/core';
import {
  type ApiTokenSummary,
  type ListTokensInput,
  type RevokeTokenInput,
  TokenError,
  type TokenStore,
} from './token-store.js';

const TOKEN_COLUMNS = `token.id,
       token.workspace_id,
       token.actor_id,
       token.label,
       token.scopes,
       token.created_at,
       token.last_used_at,
       token.expires_at,
       token.device_authorization_id,
       owner.display_name AS actor_display_name`;

const corrupt = (message: string, cause?: unknown): TokenError =>
  cause === undefined
    ? new TokenError('corrupt_token', message)
    : new TokenError('corrupt_token', message, { cause });

const readString = (row: SqlRow, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw corrupt(`Expected ${column} to be text; received ${typeof value}`);
  }
  return value;
};

const readDate = (row: SqlRow, column: string): Date => {
  const value = row[column];
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw corrupt(`Expected ${column} to be a timestamp; received ${typeof value}`);
};

const readOptionalDate = (row: SqlRow, column: string): Date | null =>
  row[column] === null || row[column] === undefined ? null : readDate(row, column);

const readScopes = (row: SqlRow): readonly string[] => {
  const value = row.scopes;
  if (!Array.isArray(value) || value.some((scope) => typeof scope !== 'string')) {
    throw corrupt('Expected scopes to be an array of text');
  }
  return value as readonly string[];
};

const toSummary = (row: SqlRow): ApiTokenSummary => ({
  id: readString(row, 'id'),
  workspaceId: readString(row, 'workspace_id'),
  actorId: readString(row, 'actor_id'),
  actorDisplayName: readString(row, 'actor_display_name'),
  label: readString(row, 'label'),
  scopes: readScopes(row),
  createdAt: readDate(row, 'created_at'),
  lastUsedAt: readOptionalDate(row, 'last_used_at'),
  expiresAt: readOptionalDate(row, 'expires_at'),
  issuedByDeviceFlow: row.device_authorization_id !== null,
});

export class PostgresTokenStore implements TokenStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async listTokens({ workspaceId }: ListTokensInput): Promise<readonly ApiTokenSummary[]> {
    return this.inTransaction(async (session) => {
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);

      const rows = await session.execute<SqlRow>(
        `SELECT ${TOKEN_COLUMNS}
           FROM api_token AS token
           JOIN actor AS owner
             ON owner.workspace_id = token.workspace_id AND owner.id = token.actor_id
          WHERE token.workspace_id = $1 AND token.revoked_at IS NULL
          ORDER BY token.created_at DESC, token.id DESC`,
        [workspaceId],
      );

      return rows.rows.map(toSummary);
    });
  }

  async revokeToken({ workspaceId, tokenId }: RevokeTokenInput): Promise<ApiTokenSummary> {
    return this.inTransaction(async (session) => {
      await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);

      const revoked = await session.execute<SqlRow>(
        `UPDATE api_token SET revoked_at = now()
          WHERE workspace_id = $1 AND id = $2 AND revoked_at IS NULL
          RETURNING id, actor_id`,
        [workspaceId, tokenId],
      );
      if (revoked.rows.length === 0) {
        throw new TokenError(
          'token_not_found',
          `Expected a live token ${tokenId} in this workspace; it was already revoked or never existed`,
        );
      }

      const rows = await session.execute<SqlRow>(
        `SELECT ${TOKEN_COLUMNS}
           FROM api_token AS token
           JOIN actor AS owner
             ON owner.workspace_id = token.workspace_id AND owner.id = token.actor_id
          WHERE token.workspace_id = $1 AND token.id = $2`,
        [workspaceId, tokenId],
      );
      const row = rows.rows[0];
      if (row === undefined) {
        throw corrupt(`Token ${tokenId} vanished between being revoked and being read back`);
      }
      return toSummary(row);
    });
  }

  private async inTransaction<T>(operation: (session: PostgresSession) => Promise<T>): Promise<T> {
    const session = await this.source.acquire();
    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      try {
        const result = await operation(session);
        await session.execute('COMMIT');
        return result;
      } catch (error) {
        await session.execute('ROLLBACK');
        throw error;
      }
    } finally {
      await session.release();
    }
  }
}
