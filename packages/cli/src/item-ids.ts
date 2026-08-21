import type { Uuid } from '@mneia/core';

export const MAX_CHAIN_REVISIONS = 200;

const HYPHENS = /-/g;

export const compactId = (id: string): string => id.replace(HYPHENS, '').toLowerCase();

export function matchItemIds(candidates: readonly Uuid[], reference: string): readonly Uuid[] {
  const wanted = compactId(reference);
  const exact = candidates.filter((id) => compactId(id) === wanted);
  if (exact.length > 0) {
    return exact;
  }
  return candidates.filter((id) => compactId(id).startsWith(wanted));
}
