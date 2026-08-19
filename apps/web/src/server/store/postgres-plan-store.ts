import 'server-only';

import type { PostgresConnectionSource, WorkspacePlan, WorkspaceScope } from '@mneia/core';
import { assertConnectionEnforcesRls, WORKSPACE_SETTING, WORKSPACE_PLANS } from '@mneia/core';

export interface WorkspaceProjectUsage {
  readonly plan: WorkspacePlan;
  readonly activeProjects: number;
  readonly slugs: readonly string[];
}

export interface PlanStore {
  projectUsage(scope: WorkspaceScope): Promise<WorkspaceProjectUsage>;
}

interface UsageRow {
  readonly plan: unknown;
  readonly slug: unknown;
}

const PLANS: ReadonlySet<string> = new Set(WORKSPACE_PLANS);

const readPlan = (value: unknown): WorkspacePlan =>
  typeof value === 'string' && PLANS.has(value) ? (value as WorkspacePlan) : 'solo';

export class PostgresPlanStore implements PlanStore {
  constructor(private readonly source: PostgresConnectionSource) {}

  async projectUsage(scope: WorkspaceScope): Promise<WorkspaceProjectUsage> {
    const session = await this.source.acquire();
    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      try {
        await session.execute('SELECT set_config($1, $2, true)', [
          WORKSPACE_SETTING,
          scope.workspaceId,
        ]);
        const result = await session.execute<UsageRow>(
          `SELECT workspace.plan AS plan, project.slug AS slug
             FROM workspace AS workspace
             LEFT JOIN project AS project
               ON project.workspace_id = workspace.id
              AND project.archived_at IS NULL
            WHERE workspace.id = $1
            ORDER BY project.slug`,
          [scope.workspaceId],
        );
        await session.execute('COMMIT');

        const slugs = result.rows
          .map((row) => row.slug)
          .filter((slug): slug is string => typeof slug === 'string');

        return {
          plan: readPlan(result.rows[0]?.plan),
          activeProjects: slugs.length,
          slugs,
        };
      } catch (error) {
        await session.execute('ROLLBACK');
        throw error;
      }
    } finally {
      await session.release();
    }
  }
}
