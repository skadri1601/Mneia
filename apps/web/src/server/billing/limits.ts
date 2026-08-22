import type { WorkspacePlan } from '@mneia/core';

/**
 * What a plan includes in a billing period.
 *
 * `null` means unmetered. Every number here is per seat: Team multiplies by the seat
 * count and pools the result across the workspace, so a heavy user draws on a quiet
 * colleague's share rather than being cut off while the team has headroom.
 *
 * ## How these were sized
 *
 * Extraction is the only thing worth metering — the LLM call is the entire marginal cost,
 * while rehydrate, handoff, search and status are one indexed query each (docs/BUSINESS.md).
 *
 * Measured from the provider dashboard over 2026-08-07 to 08-22: 159 extraction requests
 * carrying 9,849,066 input tokens, so **61,943 input tokens per request**. Against
 * gpt-5.6-luna on the flex tier ($0.10/M input, $0.60/M output), with the prompt no longer
 * rendering item ids and the prefix cached, that is about **$0.0062 per checkpoint**.
 *
 * The ceilings below sit at roughly 30% gross margin on that rate at full burn. They are
 * not a forecast of usage: over the same fortnight the heaviest workspace we have ran
 * about 10.6 checkpoints a day, so Pro's allowance is more than five times real heavy use.
 * A ceiling exists to bound a runaway client and a scripted free account, not to ration a
 * working developer.
 *
 * ## Why two dials and not one
 *
 * Cost is `turns x rate + extractions x prompt overhead`, so a single dial is gameable
 * from whichever side it does not measure. A turn allowance alone admits thousands of
 * tiny extractions paying pure overhead; an extraction allowance alone admits one
 * enormous upload. `turns` is set at `extractions x 160`, the measured mean turns per
 * checkpoint, so at typical session shape the two bind at the same point and neither
 * silently caps the other.
 *
 * `embeddingTokens` is a third, deliberately slack dial. Embeddings run about $0.04 per
 * seat per month, which is not worth a customer managing, but recording it means the
 * spend is visible and can be re-sized from data rather than guessed at again.
 */
export interface PlanLimits {
  readonly projects: number | null;
  readonly turns: number | null;
  readonly extractions: number | null;
  readonly embeddingTokens: number | null;
}

/** The measured mean turns per checkpoint, from .mneia/dogfood across 116 checkpoints. */
export const TURNS_PER_EXTRACTION = 160;

const LIMITS: Record<WorkspacePlan, PlanLimits> = {
  // Free. Its job is distribution, not revenue (vision.md §14, standing rule 7), so the
  // ceiling is set where a scripted account stops costing us meaningfully - about $2.50 a
  // month - rather than where a person would notice it.
  solo: { projects: 1, turns: 64_000, extractions: 400, embeddingTokens: 640_000 },

  // Pro, $15/mo, one seat. ~$10.54 at full burn.
  pro: { projects: null, turns: 272_000, extractions: 1_700, embeddingTokens: 2_720_000 },

  // Team, $25/seat, pooled across seats_purchased. ~$17.36 per seat at full burn.
  team: { projects: null, turns: 448_000, extractions: 2_800, embeddingTokens: 4_480_000 },

  // Not sold. This is the internal and design-partner vehicle, uncapped by construction so
  // dogfooding is never billed against a customer ceiling, and excluded from revenue
  // reporting because nothing on this plan was ever charged for. Revisit when Enterprise
  // becomes a real tier, or internal usage starts looking like customer revenue.
  enterprise: { projects: null, turns: null, extractions: null, embeddingTokens: null },
};

export const planLimits = (plan: WorkspacePlan): PlanLimits => LIMITS[plan];

/**
 * Whether a plan is paid, and therefore whether an inactive subscription should stop it.
 *
 * Kept beside the limits so adding a tier forces a decision here too. `solo` is free and
 * `enterprise` is internal, so neither has a subscription to lapse.
 */
export const PAID_PLANS: readonly WorkspacePlan[] = ['pro', 'team'];

export const isPaidPlan = (plan: WorkspacePlan): boolean => PAID_PLANS.includes(plan);

/** Only Team is sold per seat; Pro is one seat by definition and Free has no seats. */
export const isSeatedPlan = (plan: WorkspacePlan): boolean => plan === 'team';

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
