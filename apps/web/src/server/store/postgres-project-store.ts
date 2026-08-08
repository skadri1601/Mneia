import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type PostgresSession,
  type SqlRow,
  WORKSPACE_SETTING,
} from '@mneia/core';
import type { AccountContext } from './account-store.js';
import {
  type ArchiveProjectInput,
  type CreateProjectInput,
  type ListProjectsInput,
  type ManagedProject,
  ProjectControlError,
  type ProjectControlStore,
  type RenameProjectInput,
} from './project-store.js';

const PROJECT_COLUMNS =
  'id, workspace_id, team_id, slug, display_name, repo_url, archived_at, created_at';

const text = (row: SqlRow, column: string): string => {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new ProjectControlError('corrupt_project', `Expected ${column} to be text`);
  }
  return value;
};

const nullableText = (row: SqlRow, column: string): string | null => {
  const value = row[column];
  return value === null ? null : text(row, column);
};

const date = (row: SqlRow, column: string): Date => {
  const value = row[column];
  const parsed = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (parsed === null || Number.isNaN(parsed.getTime())) {
    throw new ProjectControlError('corrupt_project', `Expected ${column} to be a timestamp`);
  }
  return parsed;
};

const nullableDate = (row: SqlRow, column: string): Date | null =>
  row[column] === null ? null : date(row, column);

const mapProject = (row: SqlRow): ManagedProject => ({
  id: text(row, 'id'),
  workspaceId: text(row, 'workspace_id'),
  teamId: nullableText(row, 'team_id'),
  slug: text(row, 'slug'),
  displayName: text(row, 'display_name'),
  repoUrl: nullableText(row, 'repo_url'),
  archivedAt: nullableDate(row, 'archived_at'),
  createdAt: date(row, 'created_at'),
});

const describeCause = (cause: unknown): string =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

const exactlyOneProject = (rows: readonly SqlRow[]): ManagedProject => {
  if (rows.length !== 1) {
    throw new ProjectControlError('project_not_found', 'Project not found');
  }
  return mapProject(rows[0] as SqlRow);
};

export class PostgresProjectStore implements ProjectControlStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async listProjects(
    account: AccountContext,
    input: ListProjectsInput,
  ): Promise<readonly ManagedProject[]> {
    return this.inTransaction(account, async (session) => {
      const archivedPredicate = input.includeArchived ? '' : ' AND archived_at IS NULL';
      const result = await session.execute<SqlRow>(
        `SELECT ${PROJECT_COLUMNS}
         FROM project
         WHERE workspace_id = $1${archivedPredicate}
         ORDER BY display_name ASC, id ASC`,
        [account.workspace.id],
      );
      return result.rows.map(mapProject);
    });
  }

  async getProject(account: AccountContext, projectId: string): Promise<ManagedProject> {
    return this.inTransaction(account, async (session) => {
      const result = await session.execute<SqlRow>(
        `SELECT ${PROJECT_COLUMNS}
         FROM project
         WHERE workspace_id = $1 AND id = $2`,
        [account.workspace.id, projectId],
      );
      return exactlyOneProject(result.rows);
    });
  }

  async createProject(account: AccountContext, input: CreateProjectInput): Promise<ManagedProject> {
    return this.inTransaction(account, async (session) => {
      const result = await session.execute<SqlRow>(
        `INSERT INTO project (workspace_id, slug, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, slug) DO NOTHING
         RETURNING ${PROJECT_COLUMNS}`,
        [account.workspace.id, input.slug, input.displayName],
      );

      if (result.rows.length === 0) {
        throw new ProjectControlError(
          'slug_taken',
          `A project with the binding "${input.slug}" already exists in this workspace`,
        );
      }

      return exactlyOneProject(result.rows);
    });
  }

  async renameProject(account: AccountContext, input: RenameProjectInput): Promise<ManagedProject> {
    return this.inTransaction(account, async (session) => {
      const result = await session.execute<SqlRow>(
        `UPDATE project
         SET display_name = $3
         WHERE workspace_id = $1 AND id = $2 AND archived_at IS NULL
         RETURNING ${PROJECT_COLUMNS}`,
        [account.workspace.id, input.projectId, input.displayName],
      );
      return exactlyOneProject(result.rows);
    });
  }

  async archiveProject(
    account: AccountContext,
    input: ArchiveProjectInput,
  ): Promise<ManagedProject> {
    return this.inTransaction(account, async (session) => {
      const result = await session.execute<SqlRow>(
        `UPDATE project
         SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
         WHERE workspace_id = $1 AND id = $2 AND slug = $3
         RETURNING ${PROJECT_COLUMNS}`,
        [account.workspace.id, input.projectId, input.expectedSlug],
      );
      return exactlyOneProject(result.rows);
    });
  }

  private async inTransaction<T>(
    account: AccountContext,
    operation: (session: PostgresSession) => Promise<T>,
  ): Promise<T> {
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
      await session.execute('SELECT set_config($1, $2, true)', [
        WORKSPACE_SETTING,
        account.workspace.id,
      ]);
      const authorization = await session.execute<SqlRow>(
        `SELECT 1 AS authorized
         FROM team_member AS membership
         INNER JOIN team AS default_team
           ON default_team.workspace_id = membership.workspace_id
          AND default_team.id = membership.team_id
         WHERE membership.workspace_id = $1
           AND membership.team_id = $2
           AND membership.actor_id = $3
           AND membership.role = 'lead'
           AND default_team.slug = 'default'
         LIMIT 1`,
        [account.workspace.id, account.team.id, account.actor.id],
      );
      if (authorization.rows.length !== 1) {
        throw new ProjectControlError(
          'forbidden',
          'The current actor is not the default-team lead for this workspace',
        );
      }
      result = await operation(session);
      await session.execute('COMMIT');
      transactionStarted = false;
      completed = true;
    } catch (error) {
      failure = error;
      if (transactionStarted) {
        try {
          await session.execute('ROLLBACK');
        } catch (rollbackError) {
          discardSession = true;
          failure = new ProjectControlError(
            'rollback_failed',
            `Project operation failed with "${describeCause(error)}" and rollback failed too`,
            { cause: new AggregateError([error, rollbackError]) },
          );
        }
      }
    }

    try {
      if (discardSession) await session.discard();
      else await session.release();
    } catch (cleanupError) {
      throw new ProjectControlError(
        'session_cleanup_failed',
        `Could not ${discardSession ? 'discard' : 'release'} the Postgres project session`,
        { cause: new AggregateError(completed ? [cleanupError] : [failure, cleanupError]) },
      );
    }

    if (!completed) throw failure;
    return result as T;
  }
}
