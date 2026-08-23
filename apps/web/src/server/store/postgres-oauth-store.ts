import 'server-only';

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PostgresConnectionSource, PostgresSession, Uuid } from '@mneia/core';
import {
  API_TOKEN_HASH_SETTING,
  assertConnectionEnforcesRls,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
  IDENTITY_SUBJECT_SETTING,
  INVITATION_EMAIL_SETTING,
  INVITATION_TOKEN_HASH_SETTING,
  OAUTH_CLIENT_ID_SETTING,
  OAUTH_CODE_HASH_SETTING,
  type OAuthApplicationType,
  type OAuthTokenEndpointAuthMethod,
  WORKSPACE_SETTING,
} from '@mneia/core';

// Every GUC the RLS policies read must be reset on each transaction, not only the ones this store
// uses: a connection comes from a shared pool, and a value left behind by a previous caller would
// silently widen the next caller's policies.
const ALL_SETTINGS = [
  WORKSPACE_SETTING,
  IDENTITY_SUBJECT_SETTING,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
  API_TOKEN_HASH_SETTING,
  INVITATION_TOKEN_HASH_SETTING,
  INVITATION_EMAIL_SETTING,
  OAUTH_CLIENT_ID_SETTING,
  OAUTH_CODE_HASH_SETTING,
] as const;

export class OAuthError extends Error {
  constructor(
    readonly code:
      | 'invalid_client'
      | 'invalid_grant'
      | 'invalid_request'
      | 'invalid_redirect_uri'
      | 'server_error',
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface RegisteredClient {
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
  readonly applicationType: OAuthApplicationType;
  readonly hasSecret: boolean;
}

export interface RegisterClientInput {
  readonly clientName: string;
  readonly redirectUris: readonly string[];
  readonly tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
  readonly applicationType: OAuthApplicationType;
  readonly clientSecretHash: string | null;
}

export interface IssueCodeInput {
  readonly clientId: string;
  readonly workspaceId: Uuid;
  readonly actorId: Uuid;
  readonly redirectUri: string;
  readonly codeHash: string;
  readonly codeChallenge: string;
  readonly resource: string | null;
  readonly scope: string;
  readonly expiresAt: Date;
}

export interface ExchangedCode {
  readonly accessToken: string;
  readonly workspaceId: Uuid;
  readonly actorId: Uuid;
  readonly scope: string;
}

const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

// redirect_uris is TEXT[], and SqlValue carries no array type — nothing else in the codebase passes
// one, and widening the driver contract for a single column is the wrong trade. Postgres builds the
// array from a delimited string instead, still fully parameterized. A newline is the delimiter
// because a URL cannot contain a raw one, so no registered URI can smuggle a split past this.
const URI_DELIMITER = '\n';

/**
 * PKCE S256 verification.
 *
 * Compared with timingSafeEqual rather than `===` because the challenge is attacker-supplied and a
 * byte-by-byte comparison leaks how much of it matched. Both sides are fixed-length base64url
 * digests, so a length mismatch is itself a mismatch and never a timing signal worth protecting.
 */
export const verifyPkce = (verifier: string, challenge: string): boolean => {
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
};

interface ClientRow {
  readonly client_id: string;
  readonly client_name: string;
  readonly redirect_uris: readonly string[];
  readonly token_endpoint_auth_method: OAuthTokenEndpointAuthMethod;
  readonly application_type: OAuthApplicationType;
  readonly client_secret_hash: string | null;
}

interface CodeRow {
  readonly id: string;
  readonly client_id: string;
  readonly workspace_id: string;
  readonly actor_id: string;
  readonly redirect_uri: string;
  readonly code_challenge: string;
  readonly resource: string | null;
  readonly scope: string;
}

export class PostgresOAuthStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async registerClient(input: RegisterClientInput): Promise<RegisteredClient> {
    // A public identifier, not a secret. It is safe in a redirect URL and in client configuration,
    // which is exactly where it ends up.
    const clientId = `mneia_client_${randomUUID().replace(/-/g, '')}`;

    return this.inTransaction(async (session) => {
      await setSettings(session, {});
      await session.execute(
        `INSERT INTO oauth_client
           (id, client_id, client_secret_hash, client_name, redirect_uris,
            token_endpoint_auth_method, application_type)
         VALUES ($1, $2, $3, $4, string_to_array($5, chr(10)), $6, $7)`,
        [
          randomUUID(),
          clientId,
          input.clientSecretHash,
          input.clientName,
          input.redirectUris.join(URI_DELIMITER),
          input.tokenEndpointAuthMethod,
          input.applicationType,
        ],
      );
      return {
        clientId,
        clientName: input.clientName,
        redirectUris: input.redirectUris,
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod,
        applicationType: input.applicationType,
        hasSecret: input.clientSecretHash !== null,
      };
    });
  }

  async findClient(clientId: string): Promise<RegisteredClient | null> {
    return this.inTransaction(async (session) => {
      // The lookup policy is keyed on this GUC — knowing the client id is what grants the read.
      await setSettings(session, { [OAUTH_CLIENT_ID_SETTING]: clientId });
      const { rows } = await session.execute<ClientRow>(
        `SELECT client_id, client_name, redirect_uris, token_endpoint_auth_method,
                application_type, client_secret_hash
           FROM oauth_client`,
      );
      const row = rows[0];
      if (row === undefined) {
        return null;
      }
      return {
        clientId: row.client_id,
        clientName: row.client_name,
        redirectUris: row.redirect_uris,
        tokenEndpointAuthMethod: row.token_endpoint_auth_method,
        applicationType: row.application_type,
        hasSecret: row.client_secret_hash !== null,
      };
    });
  }

  /**
   * The stored secret hash for a confidential client, for the token endpoint to compare against.
   *
   * Kept off RegisteredClient on purpose: that type is passed to the consent page and would then
   * be one careless render away from putting a credential hash in HTML.
   */
  async clientSecretHash(clientId: string): Promise<string | null> {
    return this.inTransaction(async (session) => {
      await setSettings(session, { [OAUTH_CLIENT_ID_SETTING]: clientId });
      const { rows } = await session.execute<{ readonly client_secret_hash: string | null }>(
        'SELECT client_secret_hash FROM oauth_client',
      );
      return rows[0]?.client_secret_hash ?? null;
    });
  }

  async issueCode(input: IssueCodeInput): Promise<void> {
    await this.inTransaction(async (session) => {
      // Issued inside the approving human's workspace, which is what the insert policy checks —
      // a code can only ever be written for the workspace that actually approved it.
      await setSettings(session, { [WORKSPACE_SETTING]: input.workspaceId });
      await session.execute(
        `INSERT INTO oauth_authorization_code
           (id, code_hash, client_id, workspace_id, actor_id, redirect_uri,
            code_challenge, resource, scope, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          input.codeHash,
          input.clientId,
          input.workspaceId,
          input.actorId,
          input.redirectUri,
          input.codeChallenge,
          input.resource,
          input.scope,
          input.expiresAt.toISOString(),
        ],
      );
    });
  }

  /**
   * Exchanges an authorization code, once.
   *
   * Everything is checked inside one transaction and the row is marked redeemed before the caller
   * gets anything back, so two simultaneous exchanges of the same code cannot both succeed — the
   * migration's trigger refuses the second transition and the transaction rolls back.
   */
  async redeemCode(input: {
    readonly code: string;
    readonly clientId: string;
    readonly codeVerifier: string;
    readonly redirectUri: string;
  }): Promise<ExchangedCode> {
    const codeHash = hash(input.code);

    return this.inTransaction(async (session) => {
      await setSettings(session, { [OAUTH_CODE_HASH_SETTING]: codeHash });
      const { rows } = await session.execute<CodeRow>(
        `SELECT id, client_id, workspace_id, actor_id, redirect_uri, code_challenge, resource, scope
           FROM oauth_authorization_code
          WHERE status = 'pending' AND expires_at > now()`,
      );
      const row = rows[0];
      if (row === undefined) {
        throw new OAuthError(
          'invalid_grant',
          'That authorization code is not valid. It may have expired, or already been exchanged — start the authorization again.',
        );
      }

      // A code issued to one client must not be redeemable by another, and it must come back to
      // the redirect URI it was bound to. Both are required by OAuth 2.1 and both are cheap.
      if (row.client_id !== input.clientId) {
        throw new OAuthError(
          'invalid_grant',
          `expected the authorization code to belong to client ${row.client_id}; it was presented by ${input.clientId}`,
        );
      }
      if (row.redirect_uri !== input.redirectUri) {
        throw new OAuthError(
          'invalid_grant',
          'expected redirect_uri to match the one the authorization code was issued for; it did not',
        );
      }
      if (!verifyPkce(input.codeVerifier, row.code_challenge)) {
        throw new OAuthError(
          'invalid_grant',
          'the code_verifier does not match the code_challenge this authorization code was issued against',
        );
      }

      const updated = await session.execute<{ readonly id: string }>(
        `UPDATE oauth_authorization_code
            SET status = 'redeemed'
          WHERE id = $1 AND status = 'pending'
        RETURNING id`,
        [row.id],
      );
      if (updated.rows.length === 0) {
        throw new OAuthError(
          'invalid_grant',
          'that authorization code was exchanged by another request first',
        );
      }

      // Mint the access token in the same transaction that spent the code. If this insert fails the
      // redemption rolls back with it, so a code is never consumed without a token coming out —
      // otherwise a client is left holding a spent code and nothing to retry with.
      //
      // The token is an ordinary api_token row, which is the point of the design:
      // resolveBearerIdentity, revocation, expiry and the tokens page keep working unchanged, and
      // the API has exactly one kind of credential to understand.
      const accessToken = `mneia_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
      await setSettings(session, { [WORKSPACE_SETTING]: row.workspace_id });
      await session.execute(
        `INSERT INTO api_token (id, workspace_id, actor_id, token_hash, label)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          randomUUID(),
          row.workspace_id,
          row.actor_id,
          hash(accessToken),
          `oauth: ${row.client_id}`,
        ],
      );

      return {
        accessToken,
        workspaceId: row.workspace_id as Uuid,
        actorId: row.actor_id as Uuid,
        scope: row.scope,
      };
    });
  }

  private async inTransaction<T>(operation: (session: PostgresSession) => Promise<T>): Promise<T> {
    const session = await this.source.acquire();
    let started = false;
    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      started = true;
      const result = await operation(session);
      await session.execute('COMMIT');
      started = false;
      return result;
    } catch (error) {
      if (started) {
        try {
          await session.execute('ROLLBACK');
        } catch {
          await session.discard();
          throw error;
        }
      }
      throw error;
    } finally {
      await session.release();
    }
  }
}

const setSettings = async (
  session: PostgresSession,
  values: Readonly<Partial<Record<string, string>>>,
): Promise<void> => {
  for (const setting of ALL_SETTINGS) {
    await session.execute('SELECT set_config($1, $2, true)', [setting, values[setting] ?? '']);
  }
};

export const hashSecret = hash;
