import { describe, expect, it } from 'vitest';
import type { ContextItem, Uuid } from '../domain/types.js';
import type { ItemKind, ItemStatus } from '../store/schema.js';
import { ITEM_KINDS, ITEM_STATUSES } from '../store/schema.js';
import { DEFAULT_KIND_QUOTAS, isMandatoryItem, packSlice, sliceOverflow } from './pack.js';
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

function idsOf(entries: readonly ScoredItem[]): Uuid[] {
  return entries.map((entry) => entry.item.id);
}

function withQuotas(overrides: Partial<KindQuotas>): KindQuotas {
  return { ...DEFAULT_KIND_QUOTAS, ...overrides };
}

function loadBearingConstraint(id: string, score: number, body = SHORT): ScoredItem {
  return scored({ id, kind: 'constraint', score, status: 'active', loadBearing: true, body });
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

const COMBINATIONS = ITEM_KINDS.flatMap((kind) =>
  ITEM_STATUSES.flatMap((status) =>
    [true, false].map((loadBearing) => ({ kind, status, loadBearing })),
  ),
);

describe('GUARD §10.2: load-bearing active constraints always appear in a slice', () => {
  it('includes a load-bearing active constraint that scores dead last', () => {
    const others = [
      scored({ id: 'decision-0', kind: 'decision', score: 0.9 }),
      scored({ id: 'fact-0', kind: 'fact', score: 0.8 }),
      scored({ id: 'question-0', kind: 'open_question', score: 0.7 }),
    ];
    const mandatory = loadBearingConstraint('constraint-last', -99);
    const corpus = [...others, mandatory];

    const slice = packSlice({ scored: corpus, tokenBudget: totalCost(others) }, { counter });
    const included = idsOf(slice.items);

    expect(included).toContain('constraint-last');
    expect(included.at(-1)).toBe('constraint-last');
    expect(slice.mandatoryItemIds).toEqual(['constraint-last']);
    expect(slice.droppedItemIds).not.toContain('constraint-last');
    expect(slice.droppedItemIds.length).toBeGreaterThan(0);
  });

  it('includes every load-bearing active constraint at a budget of zero', () => {
    const mandatory = [
      loadBearingConstraint('constraint-0', 0.1),
      loadBearingConstraint('constraint-1', 0.2),
      loadBearingConstraint('constraint-2', 0.3),
    ];
    const corpus = [...facts(8), ...mandatory];

    const slice = packSlice({ scored: corpus, tokenBudget: 0 }, { counter });

    expect(new Set(slice.mandatoryItemIds)).toEqual(new Set(idsOf(mandatory)));
    expect(new Set(idsOf(slice.items))).toEqual(new Set(idsOf(mandatory)));
    expect(slice.droppedItemIds).toEqual(idsOf(facts(8)));
  });

  it('includes every load-bearing active constraint at a budget of one token', () => {
    const mandatory = [
      loadBearingConstraint('constraint-0', 0.1, LONG),
      loadBearingConstraint('constraint-1', 0.2, LONG),
    ];

    const slice = packSlice({ scored: [...facts(4), ...mandatory], tokenBudget: 1 }, { counter });

    expect(new Set(idsOf(slice.items))).toEqual(new Set(idsOf(mandatory)));
    expect(slice.tokensUsed).toBe(totalCost(mandatory));
    expect(slice.tokensUsed).toBeGreaterThan(1);
  });

  it('holds for every budget from zero up to the whole corpus', () => {
    const mandatory = [
      loadBearingConstraint('constraint-0', 0.01),
      loadBearingConstraint('constraint-1', 0.02, LONG),
    ];
    const corpus = [
      ...facts(6),
      ...mandatory,
      scored({ id: 'decision-0', kind: 'decision', score: 0.95 }),
      scored({ id: 'constraint-plain', kind: 'constraint', score: 0.94 }),
    ];
    const ceiling = totalCost(corpus);

    for (let budget = 0; budget <= ceiling; budget += 1) {
      const slice = packSlice({ scored: corpus, tokenBudget: budget }, { counter });
      const included = new Set(idsOf(slice.items));

      for (const id of idsOf(mandatory)) {
        expect(included.has(id)).toBe(true);
        expect(slice.droppedItemIds).not.toContain(id);
      }
    }
  });

  it('cannot be displaced by a flood of high-scoring facts', () => {
    const flood = facts(40);
    const mandatory = loadBearingConstraint('constraint-0', 0);

    const budget = totalCost(flood);
    const slice = packSlice({ scored: [...flood, mandatory], tokenBudget: budget }, { counter });

    expect(idsOf(slice.items)).toContain('constraint-0');
    expect(slice.mandatoryItemIds).toEqual(['constraint-0']);
    expect(slice.droppedItemIds).not.toContain('constraint-0');
    expect(slice.droppedItemIds.length).toBeGreaterThan(0);
  });

  it('survives a constraint quota of zero, which excludes every other constraint', () => {
    const mandatory = loadBearingConstraint('constraint-0', 0);
    const plain = scored({ id: 'constraint-plain', kind: 'constraint', score: 0.99 });
    const corpus = [...facts(20), mandatory, plain];
    const quotas = withQuotas({ constraint: 0 });

    const slice = packSlice(
      { scored: corpus, tokenBudget: totalCost(corpus), quotas },
      { counter },
    );
    const included = idsOf(slice.items);

    expect(included).toContain('constraint-0');
    expect(included).not.toContain('constraint-plain');
    expect(slice.mandatoryItemIds).toEqual(['constraint-0']);
  });

  it('is not charged against the constraint quota', () => {
    const mandatory = loadBearingConstraint('constraint-0', 0.1, LONG);
    const plain = scored({ id: 'constraint-plain', kind: 'constraint', score: 0.9 });
    const budget = cost(mandatory) + cost(plain);

    const slice = packSlice({ scored: [mandatory, plain], tokenBudget: budget }, { counter });

    expect(new Set(idsOf(slice.items))).toEqual(new Set(['constraint-0', 'constraint-plain']));
    expect(slice.tokensUsed).toBe(budget);
    expect(slice.droppedItemIds).toEqual([]);
  });

  it('still spends the total budget it consumes, so the rest of the slice shrinks', () => {
    const mandatory = loadBearingConstraint('constraint-0', 0.1, LONG);
    const fact = scored({ id: 'fact-0', kind: 'fact', score: 0.9 });
    const budget = cost(mandatory) + cost(fact) - 1;

    const slice = packSlice({ scored: [mandatory, fact], tokenBudget: budget }, { counter });

    expect(idsOf(slice.items)).toEqual(['constraint-0']);
    expect(slice.droppedItemIds).toEqual(['fact-0']);
    expect(slice.tokensUsed).toBe(cost(mandatory));
  });

  it('reports the overflow honestly rather than truncating a constraint away', () => {
    const mandatory = [
      loadBearingConstraint('constraint-0', 0.1, LONG),
      loadBearingConstraint('constraint-1', 0.2, LONG),
      loadBearingConstraint('constraint-2', 0.3, LONG),
    ];

    const slice = packSlice({ scored: [...facts(5), ...mandatory], tokenBudget: 10 }, { counter });

    expect(idsOf(slice.items)).toHaveLength(3);
    expect(slice.tokensUsed).toBe(totalCost(mandatory));
    expect(slice.tokensUsed).toBeGreaterThan(slice.tokenBudget);
    expect(sliceOverflow(slice)).toBe(slice.tokensUsed - 10);
    expect(slice.droppedItemIds).toEqual(idsOf(facts(5)));
  });

  it('does not force-include a superseded load-bearing constraint', () => {
    const entry = scored({
      id: 'constraint-superseded',
      kind: 'constraint',
      score: 0.9,
      status: 'superseded',
      loadBearing: true,
    });

    const slice = packSlice({ scored: [entry], tokenBudget: 0 }, { counter });

    expect(slice.mandatoryItemIds).toEqual([]);
    expect(slice.items).toEqual([]);
    expect(slice.droppedItemIds).toEqual(['constraint-superseded']);
  });

  it('does not force-include a retired load-bearing constraint', () => {
    const entry = scored({
      id: 'constraint-retired',
      kind: 'constraint',
      score: 0.9,
      status: 'retired',
      loadBearing: true,
    });

    const slice = packSlice({ scored: [entry], tokenBudget: 0 }, { counter });

    expect(slice.mandatoryItemIds).toEqual([]);
    expect(slice.droppedItemIds).toEqual(['constraint-retired']);
  });

  it('does not force-include a disputed load-bearing constraint', () => {
    const entry = scored({
      id: 'constraint-disputed',
      kind: 'constraint',
      score: 0.9,
      status: 'disputed',
      loadBearing: true,
    });

    const slice = packSlice({ scored: [entry], tokenBudget: 0 }, { counter });

    expect(slice.mandatoryItemIds).toEqual([]);
    expect(slice.droppedItemIds).toEqual(['constraint-disputed']);
  });

  it('does not force-include a load-bearing decision', () => {
    const entry = scored({
      id: 'decision-load-bearing',
      kind: 'decision',
      score: 0.9,
      status: 'active',
      loadBearing: true,
    });

    const slice = packSlice({ scored: [entry], tokenBudget: 0 }, { counter });

    expect(slice.mandatoryItemIds).toEqual([]);
    expect(slice.droppedItemIds).toEqual(['decision-load-bearing']);
  });

  it('does not force-include a constraint that is not load-bearing', () => {
    const entry = scored({ id: 'constraint-plain', kind: 'constraint', score: 0.9 });

    const slice = packSlice({ scored: [entry], tokenBudget: 0 }, { counter });

    expect(slice.mandatoryItemIds).toEqual([]);
    expect(slice.droppedItemIds).toEqual(['constraint-plain']);
  });

  it('force-includes load-bearing active constraints and nothing else, across every kind and status', () => {
    for (const { kind, status, loadBearing } of COMBINATIONS) {
      const id = `${kind}-${status}-${String(loadBearing)}`;
      const entry = scored({ id, kind, score: 0, status, loadBearing });
      const slice = packSlice({ scored: [entry], tokenBudget: 0 }, { counter });
      const forced = kind === 'constraint' && status === 'active' && loadBearing;

      expect(isMandatoryItem(entry.item)).toBe(forced);
      expect(slice.mandatoryItemIds).toEqual(forced ? [id] : []);
      expect(idsOf(slice.items)).toEqual(forced ? [id] : []);
      expect(slice.droppedItemIds).toEqual(forced ? [] : [id]);
    }
  });

  it('never reports a mandatory id as dropped or duplicated', () => {
    const mandatory = [
      loadBearingConstraint('constraint-0', 0.1, LONG),
      loadBearingConstraint('constraint-1', 0.2),
    ];
    const corpus = [...facts(10), ...mandatory];

    for (const budget of [0, 1, 25, 100, 500, 5000]) {
      const slice = packSlice({ scored: corpus, tokenBudget: budget }, { counter });
      const included = idsOf(slice.items);

      expect(new Set(included).size).toBe(included.length);
      expect(new Set(slice.mandatoryItemIds).size).toBe(slice.mandatoryItemIds.length);
      for (const id of slice.mandatoryItemIds) {
        expect(included).toContain(id);
        expect(slice.droppedItemIds).not.toContain(id);
      }
    }
  });
});
