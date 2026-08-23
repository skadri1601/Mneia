import { z } from 'zod';

/**
 * Read-only, and served for the workspace the caller's token belongs to — there is no
 * workspace or project parameter to get wrong.
 */
export const USAGE_ROUTE = '/api/v1/usage';

/**
 * Mirrors USAGE_WARN_PERCENT in apps/web/src/server/billing/usage.ts, which the CLI cannot
 * import across the package boundary. The server already sends `warn`; this exists so a
 * server that computes it differently — or forgets it — cannot under-warn a customer who is
 * demonstrably past the threshold.
 */
export const USAGE_WARN_PERCENT = 80;

export type UsageDialName = 'turns' | 'extractions';

export interface UsageDial {
  readonly used: number;
  readonly allowance: number | null;
  readonly fraction: number | null;
}

/**
 * The client's view of the server's UsageReport. `embeddingTokens` is deliberately absent:
 * the contract records it so cost is computable and says it is never rendered to a customer,
 * and --json is a customer surface. Not declaring it is what keeps it out.
 *
 * `plan` is a plain string rather than WorkspacePlan so a server that adds a plan this client
 * has never heard of still renders, instead of failing schema validation over a label.
 */
export interface UsageSnapshot {
  readonly plan: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly turns: UsageDial;
  readonly extractions: UsageDial;
  readonly checkpoints: number;
  readonly percentUsed: number | null;
  readonly warn: boolean;
}

const isoDate = z.iso.datetime({ offset: true });

const UsageDialWireSchema = z.object({
  used: z.number().nonnegative(),
  allowance: z.number().nonnegative().nullable(),
  fraction: z.number().nonnegative().nullable(),
});

const UsageSnapshotWireSchema = z.object({
  plan: z.string().min(1),
  periodStart: isoDate,
  periodEnd: isoDate,
  turns: UsageDialWireSchema,
  extractions: UsageDialWireSchema,
  checkpoints: z.number().int().nonnegative(),
  percentUsed: z.number().nonnegative().nullable(),
  warn: z.boolean(),
});

/**
 * Accepts both the enveloped and the bare body. The route and the client were built in
 * parallel, and a client that reads only one shape turns a naming disagreement into a
 * customer-visible outage for a line that is decoration.
 */
export const UsageWireSchema = z.union([
  z.object({ usage: UsageSnapshotWireSchema }),
  UsageSnapshotWireSchema.transform((usage) => ({ usage })),
]);

export interface BindingDial {
  readonly name: UsageDialName;
  readonly dial: UsageDial;
}

/**
 * Which dial the headline percentage came from. Null when no dial on this plan is capped,
 * which is the same condition that makes `percentUsed` null.
 */
export function bindingDial(usage: UsageSnapshot): BindingDial | null {
  const candidates: readonly BindingDial[] = [
    { name: 'turns', dial: usage.turns },
    { name: 'extractions', dial: usage.extractions },
  ];

  let binding: BindingDial | null = null;
  let highest = Number.NEGATIVE_INFINITY;

  for (const candidate of candidates) {
    const fraction = candidate.dial.fraction;
    if (fraction === null || !Number.isFinite(fraction) || fraction <= highest) {
      continue;
    }
    binding = candidate;
    highest = fraction;
  }

  return binding;
}

/**
 * The server clamps percentUsed to 100, so a workspace that is genuinely over its allowance
 * is indistinguishable from one sitting exactly on it unless the dials are read directly.
 */
export function isOverAllowance(usage: UsageSnapshot): boolean {
  const binding = bindingDial(usage);
  return binding !== null && binding.dial.fraction !== null && binding.dial.fraction > 1;
}

export const usageWarns = (usage: UsageSnapshot): boolean =>
  usage.warn ||
  (usage.percentUsed !== null && usage.percentUsed >= USAGE_WARN_PERCENT) ||
  isOverAllowance(usage);
