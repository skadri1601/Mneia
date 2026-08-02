import type { ContextItem, Uuid } from '../domain/types.js';
import type { ItemKind } from '../store/schema.js';
import { ITEM_KINDS } from '../store/schema.js';
import type { TokenCounter } from './tokens.js';
import { countItemTokens } from './tokens.js';
import type { KindQuotas, PackRequest, PackedSlice, ScoredItem } from './types.js';

export const DEFAULT_KIND_QUOTAS: KindQuotas = {
  constraint: 0.3,
  decision: 0.3,
  open_question: 0.2,
  fact: 0.15,
  artifact_ref: 0.05,
};

export interface PackOptions {
  readonly counter?: TokenCounter;
}

interface Candidate {
  readonly scored: ScoredItem;
  readonly cost: number;
}

type KindPools = Record<ItemKind, Candidate[]>;

interface Partitioned {
  readonly mandatory: readonly Candidate[];
  readonly pools: KindPools;
}

interface Filled {
  readonly admitted: readonly Candidate[];
  readonly remaining: number;
}

export function isMandatoryItem(item: ContextItem): boolean {
  return item.loadBearing && item.status === 'active' && item.kind === 'constraint';
}

export function sliceOverflow(slice: PackedSlice): number {
  return Math.max(0, slice.tokensUsed - slice.tokenBudget);
}

function compareUuid(a: Uuid, b: Uuid): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function byScoreThenId(a: ScoredItem, b: ScoredItem): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }
  return compareUuid(a.item.id, b.item.id);
}

function assertPackable(tokenBudget: number, quotas: KindQuotas): void {
  if (!Number.isFinite(tokenBudget)) {
    throw new Error(
      `expected tokenBudget to be a finite number of tokens; received ${String(tokenBudget)}`,
    );
  }

  for (const kind of ITEM_KINDS) {
    const share = quotas[kind];
    if (!Number.isFinite(share) || share < 0) {
      throw new Error(
        `expected the "${kind}" quota to be a finite share of 0 or greater; received ${String(share)}`,
      );
    }
  }
}

function emptyPools(): KindPools {
  return {
    decision: [],
    constraint: [],
    open_question: [],
    fact: [],
    artifact_ref: [],
  };
}

function partition(ordered: readonly ScoredItem[], counter: TokenCounter | undefined): Partitioned {
  const mandatory: Candidate[] = [];
  const pools = emptyPools();

  for (const scored of ordered) {
    const candidate: Candidate = { scored, cost: countItemTokens(scored.item, counter) };

    if (isMandatoryItem(scored.item)) {
      mandatory.push(candidate);
    } else {
      pools[scored.item.kind].push(candidate);
    }
  }

  return { mandatory, pools };
}

function fillByQuota(pools: KindPools, quotas: KindQuotas, budget: number): Filled {
  const admitted: Candidate[] = [];
  let remaining = budget;
  let progressed = true;

  while (progressed && remaining > 0) {
    progressed = false;

    const active = ITEM_KINDS.filter((kind) => quotas[kind] > 0 && pools[kind].length > 0);
    const totalShare = active.reduce((sum, kind) => sum + quotas[kind], 0);
    if (active.length === 0 || totalShare <= 0) {
      break;
    }

    const roundBudget = remaining;

    for (const kind of active) {
      const allowance = Math.floor((roundBudget * quotas[kind]) / totalShare);
      const survivors: Candidate[] = [];
      let spent = 0;

      for (const candidate of pools[kind]) {
        if (candidate.cost <= allowance - spent && candidate.cost <= remaining) {
          admitted.push(candidate);
          spent += candidate.cost;
          remaining -= candidate.cost;
          progressed = true;
        } else {
          survivors.push(candidate);
        }
      }

      pools[kind] = survivors;
    }
  }

  return { admitted, remaining };
}

function fillLeftovers(pools: KindPools, quotas: KindQuotas, budget: number): Filled {
  const leftovers = ITEM_KINDS.filter((kind) => quotas[kind] > 0).flatMap((kind) => pools[kind]);
  leftovers.sort((a, b) => byScoreThenId(a.scored, b.scored));

  const admitted: Candidate[] = [];
  let remaining = budget;

  for (const candidate of leftovers) {
    if (candidate.cost <= remaining) {
      admitted.push(candidate);
      remaining -= candidate.cost;
    }
  }

  return { admitted, remaining };
}

export function packSlice(request: PackRequest, options: PackOptions = {}): PackedSlice {
  const quotas = request.quotas ?? DEFAULT_KIND_QUOTAS;
  assertPackable(request.tokenBudget, quotas);

  const ordered = [...request.scored].sort(byScoreThenId);
  const { mandatory, pools } = partition(ordered, options.counter);

  const mandatoryTokens = mandatory.reduce((sum, candidate) => sum + candidate.cost, 0);
  const quotaPass = fillByQuota(pools, quotas, Math.max(0, request.tokenBudget - mandatoryTokens));
  const leftoverPass = fillLeftovers(pools, quotas, quotaPass.remaining);

  const included = [...mandatory, ...quotaPass.admitted, ...leftoverPass.admitted];
  const includedSet = new Set(included.map((candidate) => candidate.scored));

  return {
    items: included.map((candidate) => candidate.scored).sort(byScoreThenId),
    tokensUsed: included.reduce((sum, candidate) => sum + candidate.cost, 0),
    tokenBudget: request.tokenBudget,
    droppedItemIds: ordered
      .filter((scored) => !includedSet.has(scored))
      .map((scored) => scored.item.id),
    mandatoryItemIds: mandatory.map((candidate) => candidate.scored.item.id),
  };
}
