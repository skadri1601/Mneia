import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  type Actor,
  assertConnectionEnforcesRls,
  IDENTITY_SUBJECT_SETTING,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  toActor,
  toTeam,
  toTeamMember,
  toWorkspace,
  type Uuid,
  WORKSPACE_SETTING,
} from '@mneia/core';
import {
  type AccountContext,
  AccountError,
  type AccountStore,
  type BootstrapSoloAccountInput,
} from './account-store.js';

const WORKSPACE_COLUMNS =
  'id, slug, display_name, plan, billing_status, billing_customer_ref, seats_purchased, checkpoint_allowance, trial_ends_at, created_at';
const ACTOR_COLUMNS = 'id, workspace_id, kind, display_name, external_ref, created_at';
const TEAM_COLUMNS = 'id, workspace_id, slug, display_name, function, created_at';
const MEMBERSHIP_COLUMNS = 'workspace_id, team_id, actor_id, role, added_at';

export type AccountIdFactory = () => Uuid;

const corrupt = (message: string, cause?: unknown): AccountError =>
  cause === undefined
    ? new AccountError('corrupt_account', message)
    : new AccountError('corrupt_account', message, { cause });

const exactlyOne = <T>(rows: readonly T[], entity: string): T => {
  if (rows.length !== 1) {
    throw corrupt(`Expected exactly one ${entity}; found ${rows.length}`);
  }
  return rows[0] as T;
};

const mapExactlyOne = <T>(rows: readonly SqlRow[], entity: string, map: (row: SqlRow) => T): T => {
  const row = exactlyOne(rows, entity);
  try {
    return map(row);
  } catch (error) {
    throw corrupt(`Could not read the existing ${entity}`, error);
  }
};

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

export class PostgresAccountStore implements AccountStore {
  constructor(
    private readonly source: PostgresConnectionSource,
    private readonly idFactory: AccountIdFactory = randomUUID,
  ) {}

  async bootstrapSoloAccount(input: BootstrapSoloAccountInput): Promise<AccountContext> {
    const session = await this.source.acquire();
    let transactionStarted = false;
    let discardSession = false;
    let result: AccountContext | null = null;
    let failure: unknown;
    let failed = false;

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      transactionStarted = true;
      await session.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');

      result = await this.bootstrapInTransaction(session, input);
      await session.execute('COMMIT');
      transactionStarted = false;
    } catch (error) {
      failed = true;
      failure = error;
      if (transactionStarted) {
        try {
          await session.execute('ROLLBACK');
          transactionStarted = false;
        } catch (rollbackError) {
          discardSession = true;
          failure = new AccountError(
            'rollback_failed',
            `Account bootstrap failed with "${describeCause(error)}" and rollback failed too`,
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
      const causes = failed ? [failure, cleanupError] : [cleanupError];
      const action = discardSession ? 'discard' : 'release';
      throw new AccountError(
        'session_cleanup_failed',
        `Could not ${action} the Postgres session after account bootstrap`,
        { cause: new AggregateError(causes) },
      );
    }

    if (failed) {
      throw failure;
    }
    if (result === null) {
      throw new AccountError(
        'session_cleanup_failed',
        'Account bootstrap completed without an account context',
      );
    }
    return result;
  }

  private async bootstrapInTransaction(
    session: PostgresSession,
    input: BootstrapSoloAccountInput,
  ): Promise<AccountContext> {
    await session.execute("SELECT set_config($1, '', true)", [WORKSPACE_SETTING]);
    await session.execute('SELECT set_config($1, $2, true)', [
      IDENTITY_SUBJECT_SETTING,
      input.subject,
    ]);
    await session.execute('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.subject]);

    const actorRows = await session.execute<SqlRow>(
      `SELECT ${ACTOR_COLUMNS} FROM actor WHERE kind = 'human' AND external_ref = $1`,
      [input.subject],
    );
    await session.execute("SELECT set_config($1, '', true)", [IDENTITY_SUBJECT_SETTING]);

    if (actorRows.rows.length === 0) {
      return this.createAccount(session, input);
    }
    if (actorRows.rows.length !== 1) {
      throw corrupt(
        `Expected at most one human actor for the verified subject; found ${actorRows.rows.length}`,
      );
    }

    let actor: Actor;
    try {
      actor = toActor(actorRows.rows[0] as SqlRow);
    } catch (error) {
      throw corrupt('Could not read the existing human actor', error);
    }
    if (actor.kind !== 'human' || actor.externalRef !== input.subject) {
      throw corrupt('The existing actor does not match the verified human subject');
    }

    await session.execute('SELECT set_config($1, $2, true)', [
      WORKSPACE_SETTING,
      actor.workspaceId,
    ]);

    const workspaceRows = await session.execute<SqlRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspace WHERE id = $1`,
      [actor.workspaceId],
    );
    const teamRows = await session.execute<SqlRow>(
      `SELECT ${TEAM_COLUMNS} FROM team WHERE workspace_id = $1 AND slug = 'default'`,
      [actor.workspaceId],
    );
    const workspace = mapExactlyOne(workspaceRows.rows, 'solo workspace', toWorkspace);
    const team = mapExactlyOne(teamRows.rows, 'default team', toTeam);
    const membershipRows = await session.execute<SqlRow>(
      `SELECT ${MEMBERSHIP_COLUMNS} FROM team_member WHERE workspace_id = $1 AND team_id = $2 AND actor_id = $3`,
      [actor.workspaceId, team.id, actor.id],
    );
    const membership = mapExactlyOne(membershipRows.rows, 'default team membership', toTeamMember);

    if (workspace.id !== actor.workspaceId) {
      throw corrupt('The existing workspace is inconsistent with the human actor');
    }
    if (team.workspaceId !== workspace.id || team.slug !== 'default') {
      throw corrupt('The existing default team is inconsistent with the solo workspace');
    }
    if (
      membership.workspaceId !== workspace.id ||
      membership.teamId !== team.id ||
      membership.actorId !== actor.id ||
      membership.role !== 'lead'
    ) {
      throw corrupt('The existing default membership is inconsistent with the solo account');
    }

    return { workspace, actor, team, membership };
  }

  private async createAccount(
    session: PostgresSession,
    input: BootstrapSoloAccountInput,
  ): Promise<AccountContext> {
    const workspaceId = this.idFactory();
    const actorId = this.idFactory();
    const teamId = this.idFactory();

    await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);

    const workspaceRows = await session.execute<SqlRow>(
      `INSERT INTO workspace (id, slug, display_name, plan)
       VALUES ($1, $2, $3, 'solo')
       RETURNING ${WORKSPACE_COLUMNS}`,
      [workspaceId, `workspace-${workspaceId}`, input.displayName],
    );
    const actorRows = await session.execute<SqlRow>(
      `INSERT INTO actor (id, workspace_id, kind, display_name, external_ref)
       VALUES ($1, $2, 'human', $3, $4)
       RETURNING ${ACTOR_COLUMNS}`,
      [actorId, workspaceId, input.displayName, input.subject],
    );
    const teamRows = await session.execute<SqlRow>(
      `INSERT INTO team (id, workspace_id, slug, display_name, function)
       VALUES ($1, $2, 'default', 'Default', 'engineering')
       RETURNING ${TEAM_COLUMNS}`,
      [teamId, workspaceId],
    );
    const membershipRows = await session.execute<SqlRow>(
      `INSERT INTO team_member (workspace_id, team_id, actor_id, role)
       VALUES ($1, $2, $3, 'lead')
       RETURNING ${MEMBERSHIP_COLUMNS}`,
      [workspaceId, teamId, actorId],
    );

    return {
      workspace: mapExactlyOne(workspaceRows.rows, 'created solo workspace', toWorkspace),
      actor: mapExactlyOne(actorRows.rows, 'created human actor', toActor),
      team: mapExactlyOne(teamRows.rows, 'created default team', toTeam),
      membership: mapExactlyOne(
        membershipRows.rows,
        'created default team membership',
        toTeamMember,
      ),
    };
  }
}
