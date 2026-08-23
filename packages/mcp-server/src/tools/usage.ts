import type { UsageDialWire, UsageWire } from '@mneia/core';
import type { ToolContext } from './types.js';

/**
 * Reads the usage meter for the workspace this tool call is scoped to.
 *
 * Called after the write it should reflect, so the number an agent sees is the one its own
 * call produced rather than a stale read from before it. A probe that resolves null means
 * this server does not report usage — a local Postgres binding has no billing layer behind
 * it — and null is never the same claim as "nothing used", which is a report of zeros.
 */
export type UsageProbe = () => Promise<UsageWire | null>;

/**
 * What lands in `structuredContent.usage`. The wire fields, plus one line of prose.
 *
 * The prose is here because an agent reads text more reliably than it reads a nested number,
 * and because two nulls in this payload mean different things: `allowance` null is an
 * uncapped dial, `percentUsed` null is a plan with no capped dial at all. Making the reader
 * infer that from the shape is how a coding agent ends up telling a customer they are at 0%.
 */
export interface UsageBlock extends UsageWire {
  readonly summary: string;
}

const dateOf = (isoTimestamp: string): string => isoTimestamp.slice(0, 10);

const describeDial = (dial: UsageDialWire, noun: string): string =>
  dial.allowance === null
    ? `${dial.used} ${noun} (uncapped)`
    : `${dial.used} of ${dial.allowance} ${noun}`;

function summarise(usage: UsageWire): string {
  const dials = `${describeDial(usage.turns, 'turns')} and ${describeDial(usage.extractions, 'extractions')}`;
  const resets = `Resets ${dateOf(usage.periodEnd)}.`;

  if (usage.percentUsed === null) {
    return `${usage.plan} plan: no capped allowance — ${dials} this period. ${resets}`;
  }
  if (usage.warn) {
    return `${usage.plan} plan: ${usage.percentUsed}% of this period's allowance used — ${dials}. ${resets} Tell the human they are close to the limit; writes are refused once it is reached.`;
  }
  return `${usage.plan} plan: ${usage.percentUsed}% of this period's allowance used — ${dials}. ${resets}`;
}

export function usageBlock(usage: UsageWire | null): UsageBlock | null {
  return usage === null ? null : { ...usage, summary: summarise(usage) };
}

/**
 * Never throws and never rejects. Usage is advisory: a meter that cannot be read must not
 * turn a checkpoint that was written into a tool call that reports failure.
 */
export async function readUsage(context: ToolContext): Promise<UsageBlock | null> {
  const probe = context.usage;
  if (probe === undefined) {
    return null;
  }
  try {
    return usageBlock(await probe());
  } catch {
    return null;
  }
}

/**
 * An extra content block, not a line appended to the tool's own text. Rehydrate's text is the
 * rendered slice markdown, and splicing a warning into it would corrupt the artifact a caller
 * may store or print verbatim.
 */
export function usageWarningBlock(usage: UsageBlock | null): { type: 'text'; text: string } | null {
  return usage === null || !usage.warn ? null : { type: 'text', text: usage.summary };
}
