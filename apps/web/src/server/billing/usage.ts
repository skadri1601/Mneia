import type { UsageWire, WorkspacePlan } from '@mneia/core';
import { planLimits } from './limits.js';
import { allowanceFor, type QuotaState } from './quota.js';

/**
 * One dial of the meter. `allowance` is null when the plan does not cap this dial, and
 * `fraction` is null with it — an uncapped dial can never be a percentage of anything, and
 * returning 0 there would read as "nothing used" rather than "no limit".
 */
export interface UsageDial {
  readonly used: number;
  readonly allowance: number | null;
  readonly fraction: number | null;
}

/**
 * What every surface renders. The customer sees one percentage; the three dials are here so
 * `--json` and the billing page can show the arithmetic behind it rather than asking anyone
 * to trust a single number.
 */
export interface UsageReport {
  readonly plan: WorkspacePlan;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly turns: UsageDial;
  readonly extractions: UsageDial;
  /** Recorded so cost is computable. Never rendered to a customer — plan §10a. */
  readonly embeddingTokens: UsageDial;
  readonly checkpoints: number;
  /**
   * The larger of the turns and extractions fractions, 0-100, rounded down so 99.6% never
   * reads as 100 while the workspace can still write. Null when neither dial is capped.
   */
  readonly percentUsed: number | null;
  readonly warn: boolean;
}

export const USAGE_WARN_PERCENT = 80;

const dial = (used: number, allowance: number | null): UsageDial => ({
  used,
  allowance,
  // A zero allowance is fully spent by definition; dividing by it would give Infinity or NaN.
  fraction: allowance === null ? null : allowance === 0 ? 1 : used / allowance,
});

const boundedPercent = (fraction: number): number =>
  Math.max(0, Math.min(100, Math.floor(fraction * 100)));

/**
 * The embedding dial is deliberately excluded from the percentage. It is recorded for cost,
 * but a customer cannot act on it, and letting it bind the headline number would show a bar
 * moving for a reason nobody can explain.
 */
export function usageReport(state: QuotaState, checkpoints: number): UsageReport {
  const limits = planLimits(state.plan);

  // The same arithmetic checkpointQuota refuses on, seat pooling included. Reading the
  // per-seat figure here instead would show a three-seat team at 100% while checkpointing
  // kept working, and a meter that disagrees with the gate is worse than no meter.
  const turns = dial(state.turnsUsed, allowanceFor(state, state.turnAllowance, limits.turns));
  const extractions = dial(
    state.extractionsUsed,
    allowanceFor(state, state.extractionAllowance, limits.extractions),
  );
  const embeddingTokens = dial(
    state.embeddingTokensUsed,
    allowanceFor(state, state.embeddingTokenAllowance, limits.embeddingTokens),
  );

  const bound = [turns.fraction, extractions.fraction].filter(
    (f): f is number => f !== null && Number.isFinite(f),
  );
  const percentUsed = bound.length === 0 ? null : boundedPercent(Math.max(...bound));

  return {
    plan: state.plan,
    periodStart: state.period.start.toISOString(),
    periodEnd: state.period.end.toISOString(),
    turns,
    extractions,
    embeddingTokens,
    checkpoints,
    percentUsed,
    warn: percentUsed !== null && percentUsed >= USAGE_WARN_PERCENT,
  };
}

/**
 * What may cross the wire to a client. Everything in `UsageReport` except the embedding
 * dial, which is recorded so cost is computable and is never rendered to a customer — a
 * field that reaches a client is a field a client eventually displays. `UsageWireSchema`
 * in `@mneia/core` is the schema this must satisfy; the `Omit` keeps a dial added to
 * `UsageReport` visible here rather than silently leaking.
 */
export type ClientUsageReport = Omit<UsageReport, 'embeddingTokens'>;

export const clientVisibleUsage = (report: UsageReport): ClientUsageReport & UsageWire => ({
  plan: report.plan,
  periodStart: report.periodStart,
  periodEnd: report.periodEnd,
  turns: report.turns,
  extractions: report.extractions,
  checkpoints: report.checkpoints,
  percentUsed: report.percentUsed,
  warn: report.warn,
});
