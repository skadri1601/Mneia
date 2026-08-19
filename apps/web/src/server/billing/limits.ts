import type { WorkspacePlan } from '@mneia/core';

export interface PlanLimits {
  readonly projects: number | null;
}

const LIMITS: Record<WorkspacePlan, PlanLimits> = {
  solo: { projects: 1 },
  pro: { projects: null },
  team: { projects: null },
  enterprise: { projects: null },
};

export const planLimits = (plan: WorkspacePlan): PlanLimits => LIMITS[plan];

export type ProjectLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly limit: number; readonly current: number };

export const projectLimit = (plan: WorkspacePlan, activeProjects: number): ProjectLimitDecision => {
  const limit = planLimits(plan).projects;
  if (limit === null || activeProjects < limit) {
    return { allowed: true };
  }
  return { allowed: false, limit, current: activeProjects };
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

export const describeProjectLimit = (
  decision: Extract<ProjectLimitDecision, { allowed: false }>,
  requestedSlug: string,
  existingSlugs: readonly string[],
): string => {
  const existing =
    existingSlugs.length === 0 ? '' : ` (${existingSlugs.map((slug) => `"${slug}"`).join(', ')})`;

  return `the solo plan includes ${plural(decision.limit, 'project')} and this workspace already has ${plural(decision.current, 'project')}${existing}, so no project named "${requestedSlug}" was created — archive a project you have finished with, or move this workspace to the team plan, which has no project limit`;
};
