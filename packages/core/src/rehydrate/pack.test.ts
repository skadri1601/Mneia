import { describe, expect, it } from 'vitest';
import type { ContextItem, Uuid } from '../domain/types.js';
import type { ItemKind, ItemStatus } from '../store/schema.js';
import { DEFAULT_KIND_QUOTAS, packSlice } from './pack.js';
import { type TokenCounter, countItemTokens } from './tokens.js';
import type { KindQuotas, ScoreComponents, ScoredItem } from './types.js';

const counter: TokenCounter = { name: 'char-length', count: (text) => text.length };

const NOW = new Date('2026-07-31T12:00:00.000Z');

const SHORT = 'a'.repeat(40);
const LONG = 'a'.repeat(400);

const NO_COMPONENTS: ScoreComponents = {
  semanticRelevance: 0,
  recencyDecay: 0,
  confidence: 0,
  humanConfirmed: 0,
  loadBearing: 0,
  freshness: 0,
  disputed: 0,
};

interface Spec {
  readonly id: string;
  readonly kind: ItemKind;
  readonly score: number;
  readonly status?: ItemStatus;
  readonly loadBearing?: boolean;
  readonly body?: string;
}

function contextItem(spec: Spec): ContextItem {
  return {
    id: spec.id,
    workspaceId: 'workspace-0000',
    projectId: 'project-0000',
    kind: spec.kind,
    title: spec.id,
    body: spec.body ?? SHORT,
    status: spec.status ?? 'active',
    assertedBy: 'actor-0000',
    assertedAt: NOW,
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.9,
    humanConfirmed: true,
    loadBearing: spec.loadBearing ?? false,
    lastVerifiedAt: null,
    decayAfter: null,
    validFrom: NOW,
    validTo: null,
    supersedesId: null,
    supersededById: null,
    accessScope: 'project',
    embedding: null,
    embeddingModel: null,
  };
}

function scored(spec: Spec): ScoredItem {
  return { item: contextItem(spec), score: spec.score, components: NO_COMPONENTS };
}

function cost(entry: ScoredItem): number {
  return countItemTokens(entry.item, counter);
}

function totalCost(entries: readonly ScoredItem[]): number {
  return entries.reduce((sum, entry) => sum + cost(entry), 0);
}

function costOfFirst(entries: readonly ScoredItem[]): number {
  const head = entries[0];
  if (head === undefined) {
    throw new Error('fixture is empty');
  }
  return cost(head);
}

function idsOf(entries: readonly ScoredItem[]): Uuid[] {
  return entries.map((entry) => entry.item.id);
}

function withQuotas(overrides: Partial<KindQuotas>): KindQuotas {
  return { ...DEFAULT_KIND_QUOTAS, ...overrides };
}

function facts(count: number, body = SHORT): ScoredItem[] {
  return Array.from({ length: count }, (_unused, index) =>
    scored({
      id: `fact-${String(index).padStart(2, '0')}`,
      kind: 'fact',
      score: 1 - index / 1000,
      body,
    }),
  );
}

describe('DEFAULT_KIND_QUOTAS', () => {
  it('matches the §10.2 split for a 4k budget', () => {
    expect(DEFAULT_KIND_QUOTAS).toEqual({
      constraint: 0.3,
      decision: 0.3,
      open_question: 0.2,
      fact: 0.15,
      artifact_ref: 0.05,
    });
  });

  it('allocates the whole budget', () => {
    const total = Object.values(DEFAULT_KIND_QUOTAS).reduce((sum, share) => sum + share, 0);

    expect(total).toBeCloseTo(1, 10);
  });
});

describe('packSlice', () => {
  it('packs an empty corpus into an empty slice', () => {
    const slice = packSlice({ scored: [], tokenBudget: 4000 }, { counter });

    expect(slice.items).toEqual([]);
    expect(slice.tokensUsed).toBe(0);
    expect(slice.tokenBudget).toBe(4000);
    expect(slice.droppedItemIds).toEqual([]);
    expect(slice.mandatoryItemIds).toEqual([]);
  });

  it('admits every kind and drops nothing when the budget covers the corpus', () => {
    const corpus = [
      scored({ id: 'decision-0', kind: 'decision', score: 0.9 }),
      scored({ id: 'constraint-0', kind: 'constraint', score: 0.8 }),
      scored({ id: 'question-0', kind: 'open_question', score: 0.7 }),
      scored({ id: 'fact-0', kind: 'fact', score: 0.6 }),
      scored({ id: 'artifact-0', kind: 'artifact_ref', score: 0.5 }),
    ];

    const slice = packSlice({ scored: corpus, tokenBudget: totalCost(corpus) }, { counter });

    expect(idsOf(slice.items)).toEqual(idsOf(corpus));
    expect(slice.tokensUsed).toBe(totalCost(corpus));
    expect(slice.droppedItemIds).toEqual([]);
  });

  it('stops a flood of high-scoring facts from crowding out the constraints', () => {
    const flood = facts(20);
    const constraints = [
      scored({ id: 'constraint-0', kind: 'constraint', score: 0.01 }),
      scored({ id: 'constraint-1', kind: 'constraint', score: 0.02 }),
      scored({ id: 'constraint-2', kind: 'constraint', score: 0.03 }),
    ];
    const budget = costOfFirst(flood) * 10;

    const slice = packSlice(
      { scored: [...flood, ...constraints], tokenBudget: budget },
      { counter },
    );
    const included = new Set(idsOf(slice.items));

    for (const constraint of constraints) {
      expect(included.has(constraint.item.id)).toBe(true);
    }
    expect(slice.droppedItemIds.length).toBeGreaterThanOrEqual(10);
    expect(slice.tokensUsed).toBeLessThanOrEqual(budget);
    expect(slice.mandatoryItemIds).toEqual([]);
  });

  it('redistributes the share of kinds that have no candidates at all', () => {
    const corpus = facts(10);
    const budget = costOfFirst(corpus) * 6;

    const slice = packSlice({ scored: corpus, tokenBudget: budget }, { counter });

    expect(slice.items).toHaveLength(6);
    expect(slice.tokensUsed).toBe(budget);
    expect(slice.droppedItemIds).toHaveLength(4);
  });

  it('redistributes across rounds once a kind runs out of candidates', () => {
    const constraint = scored({ id: 'constraint-0', kind: 'constraint', score: 0.1, body: LONG });
    const fact = scored({ id: 'fact-0', kind: 'fact', score: 0.9, body: SHORT });

    expect(cost(constraint)).toBeGreaterThanOrEqual(cost(fact) * 2);

    const budget = cost(constraint) + cost(fact);
    const slice = packSlice({ scored: [constraint, fact], tokenBudget: budget }, { counter });

    expect(new Set(idsOf(slice.items))).toEqual(new Set(['constraint-0', 'fact-0']));
    expect(slice.tokensUsed).toBe(budget);
    expect(slice.droppedItemIds).toEqual([]);
  });

  it('spends budget no proportional share could absorb instead of returning a hollow slice', () => {
    const constraint = scored({ id: 'constraint-0', kind: 'constraint', score: 0.9, body: LONG });
    const fact = scored({ id: 'fact-0', kind: 'fact', score: 0.1, body: LONG.slice(0, 220) });

    expect(cost(fact) * 3).toBeGreaterThan(cost(constraint));
    expect(cost(fact)).toBeLessThan(cost(constraint));

    const budget = cost(constraint);
    const slice = packSlice({ scored: [constraint, fact], tokenBudget: budget }, { counter });

    expect(idsOf(slice.items)).toEqual(['constraint-0']);
    expect(slice.tokensUsed).toBe(budget);
    expect(slice.droppedItemIds).toEqual(['fact-0']);
  });

  it('excludes a kind whose quota share is explicitly zero', () => {
    const corpus = [...facts(4), scored({ id: 'decision-0', kind: 'decision', score: 0.1 })];

    const slice = packSlice(
      { scored: corpus, tokenBudget: totalCost(corpus), quotas: withQuotas({ fact: 0 }) },
      { counter },
    );

    expect(idsOf(slice.items)).toEqual(['decision-0']);
    expect(slice.droppedItemIds).toEqual(idsOf(facts(4)));
  });

  it('reports every item it could not fit', () => {
    const corpus = facts(12);
    const slice = packSlice({ scored: corpus, tokenBudget: costOfFirst(corpus) * 5 }, { counter });

    const included = idsOf(slice.items);
    const dropped = [...slice.droppedItemIds];

    expect(included).toHaveLength(5);
    expect(dropped).toHaveLength(7);
    expect(new Set([...included, ...dropped])).toEqual(new Set(idsOf(corpus)));
    expect(included.filter((id) => dropped.includes(id))).toEqual([]);
  });

  it('drops the entire corpus at a zero budget when nothing is mandatory', () => {
    const corpus = facts(5);
    const slice = packSlice({ scored: corpus, tokenBudget: 0 }, { counter });

    expect(slice.items).toEqual([]);
    expect(slice.tokensUsed).toBe(0);
    expect(slice.droppedItemIds).toEqual(idsOf(corpus));
  });

  it('never exceeds the budget when nothing is mandatory', () => {
    const corpus = [
      ...facts(6),
      scored({ id: 'decision-0', kind: 'decision', score: 0.5 }),
      scored({ id: 'constraint-0', kind: 'constraint', score: 0.4 }),
      scored({ id: 'question-0', kind: 'open_question', score: 0.3 }),
      scored({ id: 'artifact-0', kind: 'artifact_ref', score: 0.2 }),
    ];
    const ceiling = totalCost(corpus);

    for (let budget = 0; budget <= ceiling; budget += 1) {
      const slice = packSlice({ scored: corpus, tokenBudget: budget }, { counter });
      expect(slice.tokensUsed).toBeLessThanOrEqual(budget);
    }
  });

  it('orders the slice by descending score, breaking ties on id', () => {
    const corpus = [
      scored({ id: 'fact-b', kind: 'fact', score: 0.5 }),
      scored({ id: 'decision-a', kind: 'decision', score: 0.9 }),
      scored({ id: 'fact-a', kind: 'fact', score: 0.5 }),
      scored({ id: 'constraint-a', kind: 'constraint', score: 0.7 }),
    ];

    const slice = packSlice({ scored: corpus, tokenBudget: totalCost(corpus) }, { counter });

    expect(idsOf(slice.items)).toEqual(['decision-a', 'constraint-a', 'fact-a', 'fact-b']);
  });

  it('returns the same slice regardless of the input order', () => {
    const corpus = [
      ...facts(5),
      scored({ id: 'decision-0', kind: 'decision', score: 0.5 }),
      scored({ id: 'constraint-0', kind: 'constraint', score: 0.5 }),
    ];
    const budget = costOfFirst(corpus) * 4;

    const first = packSlice({ scored: corpus, tokenBudget: budget }, { counter });
    const second = packSlice({ scored: [...corpus].reverse(), tokenBudget: budget }, { counter });

    expect(idsOf(second.items)).toEqual(idsOf(first.items));
    expect(second.droppedItemIds).toEqual(first.droppedItemIds);
    expect(second.tokensUsed).toBe(first.tokensUsed);
  });

  it('passes the injected counter through to the token count', () => {
    const request = { scored: [scored({ id: 'fact-0', kind: 'fact', score: 1 })] };

    const plain = packSlice({ ...request, tokenBudget: 1_000_000 }, { counter });
    const inflated = packSlice(
      { ...request, tokenBudget: 1_000_000 },
      { counter: { name: 'inflated', count: (text) => text.length * 100 } },
    );

    expect(plain.tokensUsed).toBeGreaterThan(0);
    expect(inflated.tokensUsed).toBeGreaterThan(plain.tokensUsed);
  });

  it('refuses a budget that is not a finite number of tokens', () => {
    const corpus = facts(1);
    const notANumber = { scored: corpus, tokenBudget: Number.NaN };
    const infinite = { scored: corpus, tokenBudget: Number.POSITIVE_INFINITY };

    expect(() => packSlice(notANumber, { counter })).toThrow(/finite number of tokens/);
    expect(() => packSlice(infinite, { counter })).toThrow(/finite number of tokens/);
  });

  it('refuses a negative quota share', () => {
    const request = { scored: facts(1), tokenBudget: 100, quotas: withQuotas({ fact: -0.1 }) };

    expect(() => packSlice(request, { counter })).toThrow(/"fact" quota/);
  });
});
