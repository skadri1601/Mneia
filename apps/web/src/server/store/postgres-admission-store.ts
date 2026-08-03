import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
} from '@mneia/core';
import {
  AdmissionError,
  type AdmissionStore,
  type ApprovedSignup,
  type ApproveSignupInput,
  type ClaimSendInput,
  type PendingSignup,
  type SettleSendInput,
} from './admission-store.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readText = (row: SqlRow, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AdmissionError('corrupt_signup', `Expected ${column} to be a non-empty string`);
  }
  return value;
};

const readTimestamp = (row: SqlRow, column: string): string => {
  const value = row[column];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  throw new AdmissionError('corrupt_signup', `Expected ${column} to be a timestamp`);
};

const assertUuid = (value: string, label: string): string => {
  if (!UUID_PATTERN.test(value)) {
    throw new AdmissionError(
      'invalid_signup_id',
      `Expected ${label} to be a UUID; received "${value}"`,
    );
  }
  return value;
};

export class PostgresAdmissionStore implements AdmissionStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  private async withSession<T>(run: (session: PostgresSession) => Promise<T>): Promise<T> {
    const session = await this.source.acquire();

    try {
      await assertConnectionEnforcesRls(session);
      const result = await run(session);
      await session.release();
      return result;
    } catch (error) {
      try {
        await session.discard();
      } catch (cleanup) {
        throw new AdmissionError(
          'session_cleanup_failed',
          'Could not release the Postgres session after a failure',
          { cause: cleanup },
        );
      }
      throw error;
    }
  }

  async listPending(limit: number): Promise<readonly PendingSignup[]> {
    return this.withSession(async (session) => {
      const { rows } = await session.execute<SqlRow>(
        `SELECT id, email, created_at
           FROM waitlist_signup
          WHERE status = 'pending'
          ORDER BY created_at, id
          LIMIT $1`,
        [limit],
      );

      return rows.map((row) => ({
        id: readText(row, 'id'),
        email: readText(row, 'email'),
        createdAt: readTimestamp(row, 'created_at'),
      }));
    });
  }

  async approve({ signupId, approvedBy }: ApproveSignupInput): Promise<ApprovedSignup> {
    assertUuid(signupId, 'signupId');

    if (approvedBy.trim().length === 0) {
      throw new AdmissionError('invalid_signup_id', 'An approving subject is required');
    }

    return this.withSession(async (session) => {
      const { rows } = await session.execute<SqlRow>(
        `UPDATE waitlist_signup
            SET status = 'approved', approved_at = now(), approved_by = $2
          WHERE id = $1 AND status = 'pending'
      RETURNING id, email, unsubscribe_token`,
        [signupId, approvedBy.trim()],
      );

      const row = rows[0];
      if (row === undefined) {
        const { rows: existing } = await session.execute<SqlRow>(
          'SELECT status FROM waitlist_signup WHERE id = $1',
          [signupId],
        );
        throw existing[0] === undefined
          ? new AdmissionError('signup_not_found', 'No waitlist signup has that id')
          : new AdmissionError('already_decided', 'That signup has already been decided');
      }

      return {
        id: readText(row, 'id'),
        email: readText(row, 'email'),
        unsubscribeToken: readText(row, 'unsubscribe_token'),
      };
    });
  }

  async recordInvitation(signupId: string, invitationRef: string): Promise<void> {
    assertUuid(signupId, 'signupId');

    await this.withSession(async (session) => {
      await session.execute('UPDATE waitlist_signup SET invitation_ref = $2 WHERE id = $1', [
        signupId,
        invitationRef,
      ]);
    });
  }

  async claimSend({ signupId, campaign }: ClaimSendInput): Promise<string | null> {
    assertUuid(signupId, 'signupId');

    return this.withSession(async (session) => {
      const { rows } = await session.execute<SqlRow>(
        `INSERT INTO waitlist_broadcast_send (campaign, signup_id)
              VALUES ($1, $2)
         ON CONFLICT (campaign, signup_id) DO NOTHING
           RETURNING id`,
        [campaign, signupId],
      );

      const row = rows[0];
      return row === undefined ? null : readText(row, 'id');
    });
  }

  async settleSend({ claimId, providerId, delivered }: SettleSendInput): Promise<void> {
    assertUuid(claimId, 'claimId');

    await this.withSession(async (session) => {
      await session.execute(
        `UPDATE waitlist_broadcast_send
            SET status = $2,
                provider_id = $3,
                delivered_at = CASE WHEN $2 = 'sent' THEN now() ELSE NULL END
          WHERE id = $1`,
        [claimId, delivered ? 'sent' : 'unknown', providerId],
      );
    });
  }
}
