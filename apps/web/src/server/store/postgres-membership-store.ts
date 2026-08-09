import 'server-only';

import {
  assertConnectionEnforcesRls,
  type PostgresConnectionSource,
  type SqlRow,
  type TeamRole,
  WORKSPACE_SETTING,
  type WorkspaceScope,
} from '@mneia/core';

export interface MembershipStore {
  defaultTeamRole(scope: WorkspaceScope): Promise<TeamRole | null>;
}

const TEAM_ROLES: ReadonlySet<string> = new Set(['lead', 'member']);

export class PostgresMembershipStore implements MembershipStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async defaultTeamRole(scope: WorkspaceScope): Promise<TeamRole | null> {
    const session = await this.source.acquire();
    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      try {
        await session.execute('SELECT set_config($1, $2, true)', [
          WORKSPACE_SETTING,
          scope.workspaceId,
        ]);
        const result = await session.execute<SqlRow>(
          `SELECT membership.role
             FROM team_member AS membership
             INNER JOIN team AS default_team
               ON default_team.workspace_id = membership.workspace_id
              AND default_team.id = membership.team_id
            WHERE membership.workspace_id = $1
              AND membership.actor_id = $2
              AND default_team.slug = 'default'
            LIMIT 1`,
          [scope.workspaceId, scope.actorId],
        );
        await session.execute('COMMIT');

        const role = result.rows[0]?.role;
        return typeof role === 'string' && TEAM_ROLES.has(role) ? (role as TeamRole) : null;
      } catch (error) {
        await session.execute('ROLLBACK');
        throw error;
      }
    } finally {
      await session.release();
    }
  }
}
