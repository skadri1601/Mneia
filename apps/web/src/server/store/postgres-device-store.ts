import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  API_TOKEN_HASH_SETTING,
  assertConnectionEnforcesRls,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
  type DeviceAuthorizationStatus,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  type Uuid,
  WORKSPACE_SETTING,
} from '@mneia/core';
import { confirmationCodeMatches } from '../device-codes.js';
import {
  type BearerIdentity,
  type DecideAuthorizationInput,
  DeviceError,
  type DeviceStore,
  type PendingAuthorization,
  type PollResult,
  type RedeemAuthorizationInput,
  type RedeemedToken,
  type StartDeviceAuthorizationInput,
} from './device-store.js';

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MINUTES = 15;

const ALL_SETTINGS = [
  WORKSPACE_SETTING,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
  API_TOKEN_HASH_SETTING,
] as const;

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

const corrupt = (message: string, cause?: unknown): DeviceError =>
  cause === undefined
    ? new DeviceError('corrupt_device_state', message)
    : new DeviceError('corrupt_device_state', message, { cause });

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

const readStatus = (row: SqlRow): DeviceAuthorizationStatus => {
  const value = readString(row, 'status');
  if (value === 'pending' || value === 'approved' || value === 'denied' || value === 'redeemed') {
    return value;
  }
  throw corrupt(`Expected a known device authorization status; received "${value}"`);
};

export type DeviceIdFactory = () => Uuid;

type CountableFailure = 'unknown_user_code' | 'confirmation_mismatch';
type DecisionFailure = CountableFailure | 'too_many_attempts' | 'already_decided';

interface DecideOutcome {
  readonly code: DecisionFailure | null;
  readonly countable: boolean;
}

const DECISION_FAILURES: Readonly<Record<DecisionFailure, string>> = {
  too_many_attempts: `Too many incorrect confirmation numbers; wait ${ATTEMPT_WINDOW_MINUTES} minutes and start a new sign-in from the command line`,
  unknown_user_code:
    'That code is not waiting for approval — it may have expired, or already been used. Run mneia login again.',
  confirmation_mismatch: 'That confirmation number does not match the one shown in your terminal',
  already_decided: 'That sign-in request was already approved or denied. Run mneia login again.',
};

export class PostgresDeviceStore implements DeviceStore {
  constructor(
    private readonly source: PostgresConnectionSource,
    private readonly idFactory: DeviceIdFactory = randomUUID,
  ) {}

  async start(input: StartDeviceAuthorizationInput): Promise<void> {
    await this.inTransaction(async (session) => {
      await setSettings(session, { [DEVICE_CODE_HASH_SETTING]: input.deviceCodeHash });
      await session.execute(
        `INSERT INTO device_authorization
           (id, device_code_hash, user_code, confirmation_code, client_label, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
        [
          this.idFactory(),
          input.deviceCodeHash,
          input.userCode,
          input.confirmationCode,
          input.clientLabel,
          input.lifetimeSeconds,
        ],
      );
    });
  }

  async findPendingByUserCode(userCode: string): Promise<PendingAuthorization | null> {
    return this.inTransaction(async (session) => {
      await setSettings(session, { [DEVICE_USER_CODE_SETTING]: userCode });
      const { rows } = await session.execute<SqlRow>(
        'SELECT user_code, confirmation_code, client_label, expires_at FROM device_authorization',
      );
      if (rows.length === 0) return null;
      const row = rows[0] as SqlRow;
      return {
        userCode: readString(row, 'user_code'),
        confirmationCode: readString(row, 'confirmation_code'),
        clientLabel: readString(row, 'client_label'),
        expiresAt: readDate(row, 'expires_at'),
      };
    });
  }

  async decide(input: DecideAuthorizationInput): Promise<void> {
    const outcome = await this.inTransaction(async (session): Promise<DecideOutcome> => {
      await setSettings(session, {
        [WORKSPACE_SETTING]: input.workspaceId,
        [DEVICE_USER_CODE_SETTING]: input.userCode,
      });

      const attempts = await this.readAttempts(session, input.workspaceId, input.actorId);
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        return { code: 'too_many_attempts', countable: false };
      }

      const { rows } = await session.execute<SqlRow>(
        'SELECT confirmation_code FROM device_authorization WHERE user_code = $1',
        [input.userCode],
      );
      if (rows.length === 0) {
        return { code: 'unknown_user_code', countable: true };
      }

      const expected = readString(rows[0] as SqlRow, 'confirmation_code');
      if (!confirmationCodeMatches(expected, input.confirmationCode)) {
        return { code: 'confirmation_mismatch', countable: true };
      }

      const updated = await session.execute<SqlRow>(
        `UPDATE device_authorization
            SET status = $2, claimed_workspace_id = $3, claimed_actor_id = $4
          WHERE user_code = $1
          RETURNING id`,
        [input.userCode, input.approve ? 'approved' : 'denied', input.workspaceId, input.actorId],
      );
      if (updated.rows.length === 0) {
        return { code: 'already_decided', countable: false };
      }

      await this.clearAttempts(session, input.workspaceId, input.actorId);
      return { code: null, countable: false };
    });

    if (outcome.code === null) return;

    if (outcome.countable) {
      await this.inTransaction(async (session) => {
        await setSettings(session, { [WORKSPACE_SETTING]: input.workspaceId });
        await this.recordFailure(session, input.workspaceId, input.actorId);
      });
    }

    throw new DeviceError(outcome.code, DECISION_FAILURES[outcome.code]);
  }

  async poll(deviceCodeHash: string): Promise<PollResult> {
    return this.inTransaction(async (session) => {
      await setSettings(session, { [DEVICE_CODE_HASH_SETTING]: deviceCodeHash });
      const { rows } = await session.execute<SqlRow>(
        'SELECT status, claimed_workspace_id, expires_at FROM device_authorization',
      );
      if (rows.length === 0) {
        throw new DeviceError(
          'unknown_device_code',
          'That device code is not recognised. Run mneia login again.',
        );
      }

      const row = rows[0] as SqlRow;
      const status = readStatus(row);
      if (status === 'pending' && readDate(row, 'expires_at').getTime() <= Date.now()) {
        throw new DeviceError(
          'authorization_expired',
          'That sign-in request expired before it was approved. Run mneia login again.',
        );
      }

      const claimed = row.claimed_workspace_id;
      return { status, workspaceId: typeof claimed === 'string' ? claimed : null };
    });
  }

  async redeem(input: RedeemAuthorizationInput): Promise<RedeemedToken> {
    return this.inTransaction(async (session) => {
      await setSettings(session, { [DEVICE_CODE_HASH_SETTING]: input.deviceCodeHash });
      const { rows } = await session.execute<SqlRow>(
        'SELECT id, status, claimed_workspace_id, claimed_actor_id FROM device_authorization',
      );
      if (rows.length === 0) {
        throw new DeviceError(
          'unknown_device_code',
          'That device code is not recognised. Run mneia login again.',
        );
      }

      const row = rows[0] as SqlRow;
      const status = readStatus(row);
      if (status === 'pending') {
        throw new DeviceError('authorization_pending', 'Waiting for the request to be approved');
      }
      if (status === 'denied') {
        throw new DeviceError('authorization_denied', 'That sign-in request was denied');
      }
      if (status === 'redeemed') {
        throw new DeviceError(
          'already_redeemed',
          'That device code was already exchanged for a token. Run mneia login again.',
        );
      }

      const authorizationId = readString(row, 'id');
      const workspaceId = readString(row, 'claimed_workspace_id');
      const actorId = readString(row, 'claimed_actor_id');

      await setSettings(session, {
        [DEVICE_CODE_HASH_SETTING]: input.deviceCodeHash,
        [WORKSPACE_SETTING]: workspaceId,
      });

      const redeemed = await session.execute<SqlRow>(
        "UPDATE device_authorization SET status = 'redeemed' WHERE id = $1 RETURNING id",
        [authorizationId],
      );
      if (redeemed.rows.length === 0) {
        throw new DeviceError(
          'already_redeemed',
          'That device code was already exchanged for a token. Run mneia login again.',
        );
      }

      await session.execute(
        `INSERT INTO api_token
           (id, workspace_id, actor_id, token_hash, label, device_authorization_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.idFactory(), workspaceId, actorId, input.tokenHash, input.label, authorizationId],
      );

      return { workspaceId, actorId };
    });
  }

  async identify(tokenHash: string): Promise<BearerIdentity> {
    return this.inTransaction(async (session) => {
      await setSettings(session, { [API_TOKEN_HASH_SETTING]: tokenHash });
      const { rows } = await session.execute<SqlRow>(
        'SELECT id, workspace_id, actor_id FROM api_token',
      );
      if (rows.length === 0) {
        throw new DeviceError(
          'unknown_token',
          'That token is not valid. It may have been revoked or expired — run mneia login again.',
        );
      }

      const row = rows[0] as SqlRow;
      const tokenId = readString(row, 'id');
      const workspaceId = readString(row, 'workspace_id');
      const actorId = readString(row, 'actor_id');

      await setSettings(session, {
        [API_TOKEN_HASH_SETTING]: tokenHash,
        [WORKSPACE_SETTING]: workspaceId,
      });
      await session.execute('UPDATE api_token SET last_used_at = now() WHERE id = $1', [tokenId]);

      const described = await session.execute<SqlRow>(
        `SELECT w.display_name AS workspace_name,
                w.slug         AS workspace_slug,
                a.display_name AS actor_name,
                a.kind         AS actor_kind,
                t.id           AS team_id,
                t.display_name AS team_name
           FROM workspace w
           JOIN actor a ON a.workspace_id = w.id AND a.id = $2
           JOIN team  t ON t.workspace_id = w.id AND t.slug = 'default'
          WHERE w.id = $1`,
        [workspaceId, actorId],
      );
      if (described.rows.length === 0) {
        throw corrupt('A live token resolved to no workspace, actor, and default team');
      }

      const detail = described.rows[0] as SqlRow;
      return {
        tokenId,
        workspaceId,
        actorId,
        workspaceName: readString(detail, 'workspace_name'),
        workspaceSlug: readString(detail, 'workspace_slug'),
        actorName: readString(detail, 'actor_name'),
        actorKind: readString(detail, 'actor_kind'),
        teamId: readString(detail, 'team_id'),
        teamName: readString(detail, 'team_name'),
      };
    });
  }

  private async readAttempts(
    session: PostgresSession,
    workspaceId: string,
    actorId: string,
  ): Promise<number> {
    const { rows } = await session.execute<SqlRow>(
      `SELECT failed_attempts FROM device_approval_attempt
        WHERE workspace_id = $1 AND actor_id = $2
          AND window_started_at > now() - make_interval(mins => $3)`,
      [workspaceId, actorId, ATTEMPT_WINDOW_MINUTES],
    );
    if (rows.length === 0) return 0;
    const value = (rows[0] as SqlRow).failed_attempts;
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  private async recordFailure(
    session: PostgresSession,
    workspaceId: string,
    actorId: string,
  ): Promise<void> {
    await session.execute(
      `INSERT INTO device_approval_attempt (workspace_id, actor_id, failed_attempts)
       VALUES ($1, $2, 1)
       ON CONFLICT (workspace_id, actor_id) DO UPDATE
         SET failed_attempts = CASE
               WHEN device_approval_attempt.window_started_at > now() - make_interval(mins => $3)
                 THEN device_approval_attempt.failed_attempts + 1
               ELSE 1
             END,
             window_started_at = CASE
               WHEN device_approval_attempt.window_started_at > now() - make_interval(mins => $3)
                 THEN device_approval_attempt.window_started_at
               ELSE now()
             END`,
      [workspaceId, actorId, ATTEMPT_WINDOW_MINUTES],
    );
  }

  private async clearAttempts(
    session: PostgresSession,
    workspaceId: string,
    actorId: string,
  ): Promise<void> {
    await session.execute(
      'DELETE FROM device_approval_attempt WHERE workspace_id = $1 AND actor_id = $2',
      [workspaceId, actorId],
    );
  }

  private async inTransaction<T>(operation: (session: PostgresSession) => Promise<T>): Promise<T> {
    const session = await this.source.acquire();
    let transactionStarted = false;
    let discardSession = false;
    let completed = false;
    let result: T | undefined;
    let failure: unknown;

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      transactionStarted = true;
      await session.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      result = await operation(session);
      await session.execute('COMMIT');
      transactionStarted = false;
      completed = true;
    } catch (error) {
      failure = error;
      if (transactionStarted) {
        try {
          await session.execute('ROLLBACK');
          transactionStarted = false;
        } catch (rollbackError) {
          discardSession = true;
          failure = new DeviceError(
            'rollback_failed',
            `A device authorization step failed with "${describeCause(error)}" and rollback failed too`,
            { cause: new AggregateError([error, rollbackError]) },
          );
        }
      }
    }

    try {
      if (discardSession) {
        await session.discard();
      } else {
        await session.release();
      }
    } catch (cleanupError) {
      const causes = completed ? [cleanupError] : [failure, cleanupError];
      const action = discardSession ? 'discard' : 'release';
      throw new DeviceError(
        'session_cleanup_failed',
        `Could not ${action} the Postgres session after a device authorization step`,
        { cause: new AggregateError(causes) },
      );
    }

    if (!completed) throw failure;
    return result as T;
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
