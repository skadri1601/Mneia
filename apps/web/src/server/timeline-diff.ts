import type { ContextItem } from '@mneia/core';

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface ParsedAsOf {
  readonly at: Date;
  readonly invalid: boolean;
}

export const parseAsOf = (raw: string | undefined, now: Date): ParsedAsOf => {
  if (raw === undefined || raw === '') {
    return { at: now, invalid: false };
  }
  if (!DATE_ONLY.test(raw)) {
    return { at: now, invalid: true };
  }
  const parsed = new Date(`${raw}T23:59:59.999Z`);
  return Number.isNaN(parsed.getTime())
    ? { at: now, invalid: true }
    : { at: parsed, invalid: false };
};

export interface TimelineEntry {
  readonly item: ContextItem;
  readonly changed: boolean;
}

export interface BeliefDiff {
  readonly then: readonly TimelineEntry[];
  readonly since: readonly TimelineEntry[];
  readonly noLongerHolds: number;
}

export function diffBeliefs(
  believedThen: readonly ContextItem[],
  believedNow: readonly ContextItem[],
): BeliefDiff {
  const thenIds = new Set(believedThen.map((item) => item.id));
  const nowIds = new Set(believedNow.map((item) => item.id));

  const then = believedThen.map((item) => ({ item, changed: !nowIds.has(item.id) }));
  const since = believedNow
    .filter((item) => !thenIds.has(item.id))
    .map((item) => ({ item, changed: true }));

  return { then, since, noLongerHolds: then.filter((entry) => entry.changed).length };
}
