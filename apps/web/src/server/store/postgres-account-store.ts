import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  type Actor,
  assertConnectionEnforcesRls,
  IDENTITY_SUBJECT_SETTING,
  INVITATION_EMAIL_SETTING,
  INVITATION_TOKEN_HASH_SETTING,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  teamRoleForWorkspaceRole,
  toActor,
  toTeam,
  toTeamMember,
  toWorkspace,
  type Uuid,
  WORKSPACE_SETTING,
  type WorkspaceRole,
} from '@mneia/core';
import {
  type AccountContext,
  AccountError,
  type AccountStore,
  type BootstrapSoloAccountInput,
  type InviteToWorkspaceInput,
  type ListPendingInvitationsInput,
  type RedeemInvitationInput,
  type RevokeInvitationInput,
  type WorkspaceChoice,
  type WorkspaceInvitation,
} from './account-store.js';

const WORKSPACE_COLUMNS =
  'id, slug, display_name, plan, billing_status, billing_customer_ref, seats_purchased, checkpoint_allowance, trial_ends_at, created_at';
const ACTOR_COLUMNS = 'id, workspace_id, kind, display_name, external_ref, created_at';
const TEAM_COLUMNS = 'id, workspace_id, slug, display_name, function, created_at';
const MEMBERSHIP_COLUMNS = 'workspace_id, team_id, actor_id, role, added_at';
const INVITATION_COLUMNS =
  'id, workspace_id, team_id, invited_email, role, invited_by, created_at, expires_at, accepted_at, revoked_at';

const SCOPE_SETTINGS = [
  WORKSPACE_SETTING,
  IDENTITY_SUBJECT_SETTING,
  INVITATION_EMAIL_SETTING,
  INVITATION_TOKEN_HASH_SETTING,
] as const;

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

const readRole = (row: SqlRow): WorkspaceRole => {
  const value = readString(row, 'role');
  if (value === 'owner' || value === 'admin' || value === 'member') return value;
  throw corrupt(`Expected a known workspace role; received "${value}"`);
};

const toInvitation = (row: SqlRow): WorkspaceInvitation => ({
  id: readString(row, 'id'),
  workspaceId: readString(row, 'workspace_id'),
  teamId: readString(row, 'team_id'),
  invitedEmail: readString(row, 'invited_email'),
  role: readRole(row),
  invitedBy: readString(row, 'invited_by'),
  createdAt: readDate(row, 'created_at'),
  expiresAt: readDate(row, 'expires_at'),
  acceptedAt: readOptionalDate(row, 'accepted_at'),
  revokedAt: readOptionalDate(row, 'revoked_at'),
});

const setScope = async (
  session: PostgresSession,
  values: Readonly<Partial<Record<string, string>>>,
): Promise<void> => {
  for (const setting of SCOPE_SETTINGS) {
    await session.execute('SELECT set_config($1, $2, true)', [setting, values[setting] ?? '']);
  }
};

const toChoice = (row: SqlRow): WorkspaceChoice => ({
  id: readString(row, 'id'),
  slug: readString(row, 'slug'),
  displayName: readString(row, 'display_name'),
});

const readWorkspaceChoices = async (
  session: PostgresSession,
  workspaceIds: readonly string[],
): Promise<readonly WorkspaceChoice[]> => {
  const choices: WorkspaceChoice[] = [];
  for (const workspaceId of workspaceIds) {
    await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
    const rows = await session.execute<SqlRow>(
      'SELECT id, slug, display_name FROM workspace WHERE id = $1',
      [workspaceId],
    );
    const row = rows.rows[0];
    if (row !== undefined) {
      choices.push(toChoice(row));
    }
  }
  return choices;
};

export class PostgresAccountStore implements AccountStore {
  constructor(
    private readonly source: PostgresConnectionSource,
    private readonly idFactory: AccountIdFactory = randomUUID,
  ) {}

  async bootstrapSoloAccount(input: BootstrapSoloAccountInput): Promise<AccountContext> {
    return this.inTransaction((session) => this.bootstrapInTransaction(session, input));
  }

  async inviteToWorkspace(input: InviteToWorkspaceInput): Promise<WorkspaceInvitation> {
    return this.inTransaction(async (session) => {
      await setScope(session, { [WORKSPACE_SETTING]: input.workspaceId });

      const rows = await session.execute<SqlRow>(
        `INSERT INTO workspace_invitation
           (id, workspace_id, team_id, invited_email, token_hash, role, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6::workspace_role, $7, $8)
         RETURNING ${INVITATION_COLUMNS}`,
        [
          this.idFactory(),
          input.workspaceId,
          input.teamId,
          input.invitedEmail,
          input.tokenHash,
          input.role,
          input.invitedByActorId,
          input.expiresAt.toISOString(),
        ],
      );

      return mapExactlyOne(rows.rows, 'created workspace invitation', toInvitation);
    });
  }

  async listPendingInvitations({
    workspaceId,
  }: ListPendingInvitationsInput): Promise<readonly WorkspaceInvitation[]> {
    return this.inTransaction(async (session) => {
      await setScope(session, { [WORKSPACE_SETTING]: workspaceId });

      const rows = await session.execute<SqlRow>(
        `SELECT ${INVITATION_COLUMNS} FROM workspace_invitation
          WHERE workspace_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL
          ORDER BY created_at DESC`,
        [workspaceId],
      );

      return rows.rows.map(toInvitation);
    });
  }

  async revokeInvitation({
    workspaceId,
    invitationId,
  }: RevokeInvitationInput): Promise<WorkspaceInvitation> {
    return this.inTransaction(async (session) => {
      await setScope(session, { [WORKSPACE_SETTING]: workspaceId });

      const rows = await session.execute<SqlRow>(
        `UPDATE workspace_invitation SET revoked_at = now()
          WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
          RETURNING ${INVITATION_COLUMNS}`,
        [workspaceId, invitationId],
      );

      if (rows.rows.length === 0) {
        throw new AccountError(
          'invitation_not_found',
          `Expected a pending invitation ${invitationId} in this workspace; it was already accepted, already revoked, or never existed`,
        );
      }

      return mapExactlyOne(rows.rows, 'revoked workspace invitation', toInvitation);
    });
  }

  async redeemInvitation(input: RedeemInvitationInput): Promise<AccountContext | null> {
    return this.inTransaction(async (session) => {
      await setScope(session, { [IDENTITY_SUBJECT_SETTING]: input.subject });
      await session.execute('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        input.subject,
      ]);

      const existing = await session.execute<SqlRow>(
        `SELECT ${ACTOR_COLUMNS} FROM actor WHERE kind = 'human' AND external_ref = $1`,
        [input.subject],
      );
      const alreadyIn = new Set(existing.rows.map((row) => readString(row, 'workspace_id')));

      const lookupScope: Record<string, string> = {
        [INVITATION_EMAIL_SETTING]: input.verifiedEmail,
      };
      if (input.tokenHash !== undefined) {
        lookupScope[INVITATION_TOKEN_HASH_SETTING] = input.tokenHash;
      }
      await setScope(session, lookupScope);

      const pending = await session.execute<SqlRow>(
        `SELECT ${INVITATION_COLUMNS} FROM workspace_invitation
          WHERE invited_email = $1 AND ($2::text IS NULL OR token_hash = $2)
          ORDER BY created_at ASC
          LIMIT 1`,
        [input.verifiedEmail, input.tokenHash ?? null],
      );
      if (pending.rows.length === 0) {
        return null;
      }

      const invitation = mapExactlyOne(pending.rows, 'pending workspace invitation', toInvitation);
      if (alreadyIn.has(invitation.workspaceId)) {
        return null;
      }
      return this.acceptInTransaction(session, invitation, input);
    });
  }

  private async acceptInTransaction(
    session: PostgresSession,
    invitation: WorkspaceInvitation,
    input: RedeemInvitationInput,
  ): Promise<AccountContext> {
    const actorId = this.idFactory();
    await setScope(session, {
      [WORKSPACE_SETTING]: invitation.workspaceId,
      [IDENTITY_SUBJECT_SETTING]: input.subject,
    });

    const existingIdentity = await session.execute<SqlRow>(
      'SELECT id FROM identity WHERE subject = $1',
      [input.subject],
    );
    const identityRows =
      existingIdentity.rows.length > 0
        ? existingIdentity
        : await session.execute<SqlRow>(
            `INSERT INTO identity (id, subject)
             VALUES (gen_random_uuid(), $1)
             RETURNING id`,
            [input.subject],
          );
    const identityId = mapExactlyOne(identityRows.rows, 'identity', (row) => String(row.id));

    await session.execute(
      `INSERT INTO workspace_member (workspace_id, identity_id, role)
       VALUES ($1, $2, $3::workspace_role)
       ON CONFLICT (workspace_id, identity_id) DO NOTHING`,
      [invitation.workspaceId, identityId, invitation.role],
    );

    const actorRows = await session.execute<SqlRow>(
      `INSERT INTO actor (id, workspace_id, identity_id, kind, display_name, external_ref)
       VALUES ($1, $2, $3, 'human', $4, $5)
       RETURNING ${ACTOR_COLUMNS}`,
      [actorId, invitation.workspaceId, identityId, input.displayName, input.subject],
    );
    const membershipRows = await session.execute<SqlRow>(
      `INSERT INTO team_member (workspace_id, team_id, actor_id, role)
       VALUES ($1, $2, $3, $4::team_role)
       RETURNING ${MEMBERSHIP_COLUMNS}`,
      [
        invitation.workspaceId,
        invitation.teamId,
        actorId,
        teamRoleForWorkspaceRole(invitation.role),
      ],
    );
    const acceptedRows = await session.execute<SqlRow>(
      `UPDATE workspace_invitation SET accepted_at = now(), accepted_actor_id = $3
        WHERE workspace_id = $1 AND id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING ${INVITATION_COLUMNS}`,
      [invitation.workspaceId, invitation.id, actorId],
    );
    if (acceptedRows.rows.length !== 1) {
      throw new AccountError(
        'invitation_not_found',
        `Expected invitation ${invitation.id} to still be pending when it was accepted; it was settled by another request`,
      );
    }

    const workspaceRows = await session.execute<SqlRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspace WHERE id = $1`,
      [invitation.workspaceId],
    );
    const teamRows = await session.execute<SqlRow>(
      `SELECT ${TEAM_COLUMNS} FROM team WHERE workspace_id = $1 AND id = $2`,
      [invitation.workspaceId, invitation.teamId],
    );

    const workspace = mapExactlyOne(workspaceRows.rows, 'inviting workspace', toWorkspace);

    return {
      workspace,
      actor: mapExactlyOne(actorRows.rows, 'invited human actor', toActor),
      team: mapExactlyOne(teamRows.rows, 'invited team', toTeam),
      membership: mapExactlyOne(membershipRows.rows, 'invited team membership', toTeamMember),
      workspaces: [{ id: workspace.id, slug: workspace.slug, displayName: workspace.displayName }],
    };
  }

  private async bootstrapInTransaction(
    session: PostgresSession,
    input: BootstrapSoloAccountInput,
  ): Promise<AccountContext> {
    await setScope(session, { [IDENTITY_SUBJECT_SETTING]: input.subject });
    await session.execute('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [input.subject]);

    const actorRows = await session.execute<SqlRow>(
      `SELECT ${ACTOR_COLUMNS} FROM actor WHERE kind = 'human' AND external_ref = $1
        ORDER BY created_at ASC, id ASC`,
      [input.subject],
    );
    await session.execute("SELECT set_config($1, '', true)", [IDENTITY_SUBJECT_SETTING]);

    if (actorRows.rows.length === 0) {
      return this.createAccount(session, input);
    }
    let candidates: Actor[];
    try {
      candidates = actorRows.rows.map((row) => toActor(row as SqlRow));
    } catch (error) {
      throw corrupt('Could not read the existing human actor', error);
    }

    const preferred = input.preferredWorkspaceId ?? null;
    const actor =
      (preferred === null
        ? undefined
        : candidates.find((candidate) => candidate.workspaceId === preferred)) ??
      (candidates[0] as Actor);
    if (actor.kind !== 'human' || actor.externalRef !== input.subject) {
      throw corrupt('The existing actor does not match the verified human subject');
    }

    const workspaces = await readWorkspaceChoices(
      session,
      candidates.map((candidate) => candidate.workspaceId),
    );

    await session.execute('SELECT set_config($1, $2, true)', [
      WORKSPACE_SETTING,
      actor.workspaceId,
    ]);

    const workspaceRows = await session.execute<SqlRow>(
      `SELECT ${WORKSPACE_COLUMNS} FROM workspace WHERE id = $1`,
      [actor.workspaceId],
    );
    const membershipRows = await session.execute<SqlRow>(
      `SELECT ${MEMBERSHIP_COLUMNS} FROM team_member WHERE workspace_id = $1 AND actor_id = $2
        ORDER BY added_at ASC LIMIT 1`,
      [actor.workspaceId, actor.id],
    );
    const workspace = mapExactlyOne(workspaceRows.rows, 'workspace', toWorkspace);
    const membership = mapExactlyOne(membershipRows.rows, 'team membership', toTeamMember);
    const teamRows = await session.execute<SqlRow>(
      `SELECT ${TEAM_COLUMNS} FROM team WHERE workspace_id = $1 AND id = $2`,
      [actor.workspaceId, membership.teamId],
    );
    const team = mapExactlyOne(teamRows.rows, 'team', toTeam);

    if (workspace.id !== actor.workspaceId) {
      throw corrupt('The existing workspace is inconsistent with the human actor');
    }
    if (team.workspaceId !== workspace.id) {
      throw corrupt('The existing team is inconsistent with the workspace');
    }
    if (
      membership.workspaceId !== workspace.id ||
      membership.teamId !== team.id ||
      membership.actorId !== actor.id
    ) {
      throw corrupt('The existing membership is inconsistent with the account');
    }

    return { workspace, actor, team, membership, workspaces };
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

    const created = mapExactlyOne(workspaceRows.rows, 'created solo workspace', toWorkspace);

    return {
      workspace: created,
      workspaces: [{ id: created.id, slug: created.slug, displayName: created.displayName }],
      actor: mapExactlyOne(actorRows.rows, 'created human actor', toActor),
      team: mapExactlyOne(teamRows.rows, 'created default team', toTeam),
      membership: mapExactlyOne(
        membershipRows.rows,
        'created default team membership',
        toTeamMember,
      ),
    };
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
          failure = new AccountError(
            'rollback_failed',
            `An account step failed with "${describeCause(error)}" and rollback failed too`,
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
      throw new AccountError(
        'session_cleanup_failed',
        `Could not ${action} the Postgres session after an account step`,
        { cause: new AggregateError(causes) },
      );
    }

    if (!completed) throw failure;
    return result as T;
  }
}
