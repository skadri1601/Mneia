import { describe, expect, it } from 'vitest';
import type { ContextItem } from '../domain/types.js';
import { ITEM_KINDS } from '../store/schema.js';
import { isMandatoryItem, packSlice } from './pack.js';
import {
  DEFAULT_DECAY_AFTER_BY_KIND,
  DEFAULT_SCORING_WEIGHTS,
  decayAfterFor,
  freshness,
  NEUTRAL_SEMANTIC_RELEVANCE,
  RECENCY_HALF_LIFE_MS,
  recencyDecay,
  scoreComponents,
  scoreItems,
  semanticRelevance,
  totalScore,
} from './score.js';
import type { DecayDefaults, ScoreComponents, ScoringWeights } from './types.js';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);

const BASE_ITEM: ContextItem = {
  id: '00000000-0000-4000-8000-000000000000',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  kind: 'fact',
  title: 'base item',
  body: null,
  status: 'active',
  assertedBy: '33333333-3333-4333-8333-333333333333',
  assertedAt: NOW,
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.5,
  humanConfirmed: false,
  loadBearing: false,
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

const item = (overrides: Partial<ContextItem> = {}): ContextItem => ({
  ...BASE_ITEM,
  ...overrides,
});

const componentValues = (components: ScoreComponents): number[] => [
  components.semanticRelevance,
  components.recencyDecay,
  components.confidence,
  components.humanConfirmed,
  components.loadBearing,
  components.freshness,
  components.disputed,
];

describe('semanticRelevance', () => {
  it('scores an identical direction at 1', () => {
    expect(semanticRelevance([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  it('scores an orthogonal embedding at 0', () => {
    expect(semanticRelevance([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
  });

  it('floors an opposing embedding at 0 rather than going negative', () => {
    expect(semanticRelevance([1, 0, 0], [-1, 0, 0])).toBe(0);
  });

  it('scores a partial match between 0 and 1', () => {
    const relevance = semanticRelevance([1, 1, 0], [1, 0, 0]);

    expect(relevance).toBeGreaterThan(0);
    expect(relevance).toBeLessThan(1);
  });

  it('returns the neutral value when the item has no embedding', () => {
    expect(semanticRelevance(null, [1, 0, 0])).toBe(NEUTRAL_SEMANTIC_RELEVANCE);
  });

  it('returns the neutral value when the task has no embedding', () => {
    expect(semanticRelevance([1, 0, 0], null)).toBe(NEUTRAL_SEMANTIC_RELEVANCE);
  });

  it('ranks an unembedded item above a genuinely irrelevant embedded one', () => {
    expect(semanticRelevance(null, [1, 0, 0])).toBeGreaterThan(
      semanticRelevance([0, 1, 0], [1, 0, 0]),
    );
  });

  it('returns the neutral value for an empty or zero-magnitude vector', () => {
    expect(semanticRelevance([], [])).toBe(NEUTRAL_SEMANTIC_RELEVANCE);
    expect(semanticRelevance([0, 0, 0], [1, 0, 0])).toBe(NEUTRAL_SEMANTIC_RELEVANCE);
  });

  it('refuses to compare embeddings of different dimensions', () => {
    expect(() => semanticRelevance([1, 0, 0], [1, 0])).toThrow(/3 dimensions.*task embedding of 2/);
  });
});

describe('recencyDecay', () => {
  it('scores an item asserted now at 1', () => {
    expect(recencyDecay(NOW, NOW)).toBe(1);
  });

  it('halves at each half-life', () => {
    expect(recencyDecay(at(-RECENCY_HALF_LIFE_MS), NOW)).toBeCloseTo(0.5, 10);
    expect(recencyDecay(at(-2 * RECENCY_HALF_LIFE_MS), NOW)).toBeCloseTo(0.25, 10);
    expect(recencyDecay(at(-4 * RECENCY_HALF_LIFE_MS), NOW)).toBeCloseTo(0.0625, 10);
  });

  it('decays monotonically and stays inside 0..1', () => {
    const ages = [0, 1, DAY_MS, 30 * DAY_MS, 365 * DAY_MS, 50 * 365 * DAY_MS];
    const values = ages.map((age) => recencyDecay(at(-age), NOW));

    for (const value of values) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index] ?? 1).toBeLessThanOrEqual(values[index - 1] ?? 0);
    }
  });

  it('clamps a future assertion to 1 rather than exceeding the range', () => {
    expect(recencyDecay(at(30 * DAY_MS), NOW)).toBe(1);
  });

  it('accepts a tuned half-life', () => {
    expect(recencyDecay(at(-DAY_MS), NOW, DAY_MS)).toBeCloseTo(0.5, 10);
  });
});

describe('freshness', () => {
  it('scores a null decayAfter at 1 no matter how old the item is', () => {
    expect(freshness(null, at(-3650 * DAY_MS), null, NOW)).toBe(1);
  });

  it('scores 1 inside the decay window', () => {
    expect(freshness(null, at(-3 * DAY_MS), 7 * DAY_MS, NOW)).toBe(1);
  });

  it('scores 1 at the exact edge of the decay window', () => {
    expect(freshness(null, at(-7 * DAY_MS), 7 * DAY_MS, NOW)).toBe(1);
  });

  it('halves one window past the deadline and again at two', () => {
    expect(freshness(null, at(-14 * DAY_MS), 7 * DAY_MS, NOW)).toBeCloseTo(0.5, 10);
    expect(freshness(null, at(-21 * DAY_MS), 7 * DAY_MS, NOW)).toBeCloseTo(0.25, 10);
  });

  it('measures from lastVerifiedAt in preference to assertedAt', () => {
    expect(freshness(at(-DAY_MS), at(-400 * DAY_MS), 7 * DAY_MS, NOW)).toBe(1);
  });

  it('stays inside 0..1 for a long-expired item', () => {
    const value = freshness(null, at(-3650 * DAY_MS), DAY_MS, NOW);

    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(0.01);
  });
});

describe('scoreComponents', () => {
  it('clamps confidence into 0..1', () => {
    expect(scoreComponents(item({ confidence: 1.7 }), null, NOW).confidence).toBe(1);
    expect(scoreComponents(item({ confidence: -0.4 }), null, NOW).confidence).toBe(0);
    expect(scoreComponents(item({ confidence: 0.62 }), null, NOW).confidence).toBeCloseTo(0.62, 10);
  });

  it('reports the human-confirmed and load-bearing flags as 0 or 1', () => {
    const flagged = item({ humanConfirmed: true, loadBearing: true });
    const confirmed = scoreComponents(flagged, null, NOW);
    const unconfirmed = scoreComponents(item(), null, NOW);

    expect(confirmed.humanConfirmed).toBe(1);
    expect(confirmed.loadBearing).toBe(1);
    expect(unconfirmed.humanConfirmed).toBe(0);
    expect(unconfirmed.loadBearing).toBe(0);
  });

  it('flags only the disputed status', () => {
    expect(scoreComponents(item({ status: 'disputed' }), null, NOW).disputed).toBe(1);
    for (const status of ['active', 'superseded', 'retired'] as const) {
      expect(scoreComponents(item({ status }), null, NOW).disputed).toBe(0);
    }
  });

  it('keeps every component inside 0..1 across a mixed corpus', () => {
    const corpus = [
      item(),
      item({ confidence: 9, humanConfirmed: true, loadBearing: true, embedding: [1, 0, 0] }),
      item({ confidence: -3, status: 'disputed', assertedAt: at(-900 * DAY_MS) }),
      item({ assertedAt: at(900 * DAY_MS), decayAfter: 0, lastVerifiedAt: at(-DAY_MS) }),
      item({ decayAfter: 7 * DAY_MS, lastVerifiedAt: at(-900 * DAY_MS), embedding: [0, -1, 0] }),
    ];

    for (const candidate of corpus) {
      for (const value of componentValues(scoreComponents(candidate, [1, 0, 0], NOW))) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('totalScore', () => {
  it('subtracts the disputed weight rather than adding it', () => {
    const components = scoreComponents(item({ status: 'disputed' }), null, NOW);
    const undisputed = scoreComponents(item(), null, NOW);

    expect(totalScore(components)).toBeCloseTo(
      totalScore(undisputed) - DEFAULT_SCORING_WEIGHTS.disputed,
      10,
    );
  });

  it('scores a maximal item at the sum of the positive weights', () => {
    const maximal = item({
      confidence: 1,
      humanConfirmed: true,
      loadBearing: true,
      embedding: [1, 0, 0],
    });
    const positiveSum =
      DEFAULT_SCORING_WEIGHTS.semanticRelevance +
      DEFAULT_SCORING_WEIGHTS.recencyDecay +
      DEFAULT_SCORING_WEIGHTS.confidence +
      DEFAULT_SCORING_WEIGHTS.humanConfirmed +
      DEFAULT_SCORING_WEIGHTS.loadBearing +
      DEFAULT_SCORING_WEIGHTS.freshness;

    expect(totalScore(scoreComponents(maximal, [1, 0, 0], NOW))).toBeCloseTo(positiveSum, 10);
  });
});

describe('scoreItems', () => {
  it('is deterministic for a fixed now, reading the clock only from the input', () => {
    const items = [
      item({ id: 'a', assertedAt: at(-3 * DAY_MS), embedding: [0.2, 0.9, 0.1] }),
      item({ id: 'b', loadBearing: true, decayAfter: 2 * DAY_MS }),
      item({ id: 'c', assertedAt: at(-RECENCY_HALF_LIFE_MS) }),
    ];
    const input = { items, taskEmbedding: [1, 0, 0], now: NOW } as const;

    const first = scoreItems(input);
    const second = scoreItems(input);

    expect(first).toEqual(second);
    const halfLived = first.find((scored) => scored.item.id === 'c');
    expect(halfLived?.components.recencyDecay).toBeCloseTo(0.5, 10);
  });

  it('ranks a load-bearing, human-confirmed, recent item above a stale disputed one', () => {
    const strong = item({
      id: 'strong',
      kind: 'constraint',
      loadBearing: true,
      humanConfirmed: true,
      confidence: 0.9,
      assertedAt: at(-DAY_MS),
      embedding: [1, 0, 0],
    });
    const weak = item({
      id: 'weak',
      status: 'disputed',
      confidence: 0.2,
      assertedAt: at(-200 * DAY_MS),
      lastVerifiedAt: at(-200 * DAY_MS),
      decayAfter: DAY_MS,
      embedding: [0, 1, 0],
    });

    const ranked = scoreItems({ items: [weak, strong], taskEmbedding: [1, 0, 0], now: NOW });

    expect(ranked.map((scored) => scored.item.id)).toEqual(['strong', 'weak']);
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it('returns the same order regardless of input order, breaking ties by id', () => {
    const first = item({ id: 'aaa' });
    const second = item({ id: 'bbb' });

    const forward = scoreItems({ items: [first, second], taskEmbedding: null, now: NOW });
    const reversed = scoreItems({ items: [second, first], taskEmbedding: null, now: NOW });

    expect(forward.map((scored) => scored.item.id)).toEqual(['aaa', 'bbb']);
    expect(reversed.map((scored) => scored.item.id)).toEqual(['aaa', 'bbb']);
  });

  it('carries the component breakdown alongside the total', () => {
    const confirmed = item({ humanConfirmed: true });
    const [scored] = scoreItems({ items: [confirmed], taskEmbedding: null, now: NOW });
    const expected = totalScore(scoreComponents(confirmed, null, NOW));

    expect(scored?.components.humanConfirmed).toBe(1);
    expect(scored?.score).toBeCloseTo(expected, 10);
  });

  it('honours tuned weights', () => {
    const loadBearingOnly: ScoringWeights = {
      semanticRelevance: 0,
      recencyDecay: 0,
      confidence: 0,
      humanConfirmed: 0,
      loadBearing: 1,
      freshness: 0,
      disputed: 0,
    };
    const items = [item({ id: 'plain' }), item({ id: 'bearing', loadBearing: true })];

    const ranked = scoreItems({
      items,
      taskEmbedding: null,
      now: NOW,
      weights: loadBearingOnly,
    });

    expect(ranked.map((scored) => scored.score)).toEqual([1, 0]);
    expect(ranked[0]?.item.id).toBe('bearing');
  });

  it('returns an empty ranking for an empty candidate set', () => {
    expect(scoreItems({ items: [], taskEmbedding: null, now: NOW })).toEqual([]);
  });
});

describe('DEFAULT_DECAY_AFTER_BY_KIND', () => {
  it('names a default for every item kind', () => {
    expect(Object.keys(DEFAULT_DECAY_AFTER_BY_KIND).sort()).toEqual([...ITEM_KINDS].sort());
  });

  it('holds a constraint until it is explicitly superseded rather than decaying it', () => {
    const ancient = item({ kind: 'constraint', assertedAt: at(-3650 * DAY_MS) });

    expect(DEFAULT_DECAY_AFTER_BY_KIND.constraint).toBeNull();
    expect(decayAfterFor(ancient)).toBeNull();
    expect(scoreComponents(ancient, null, NOW).freshness).toBe(1);
  });

  it('stales a fact faster than a decision of the same age', () => {
    const age = 200 * DAY_MS;
    const fact = scoreComponents(item({ kind: 'fact', assertedAt: at(-age) }), null, NOW);
    const decision = scoreComponents(item({ kind: 'decision', assertedAt: at(-age) }), null, NOW);

    expect(decision.freshness).toBe(1);
    expect(fact.freshness).toBeLessThan(1);
    expect(fact.freshness).toBeLessThan(decision.freshness);
  });

  it('orders the defaults so a longer-lived kind is never staler than a shorter-lived one', () => {
    const ladder = ['fact', 'artifact_ref', 'open_question', 'decision'] as const;
    const windows = ladder.map(
      (kind) => DEFAULT_DECAY_AFTER_BY_KIND[kind] ?? Number.POSITIVE_INFINITY,
    );

    for (let index = 1; index < windows.length; index += 1) {
      expect(windows[index] ?? 0).toBeGreaterThan(windows[index - 1] ?? 0);
    }
    expect(DEFAULT_DECAY_AFTER_BY_KIND.constraint).toBeNull();
  });

  it('down-ranks a stale fact below an otherwise identical fresh one', () => {
    const fresh = item({ id: 'fresh', kind: 'fact', assertedAt: at(-DAY_MS) });
    const stale = item({ id: 'stale', kind: 'fact', assertedAt: at(-400 * DAY_MS) });

    const ranked = scoreItems({ items: [stale, fresh], taskEmbedding: null, now: NOW });

    expect(ranked.map((scored) => scored.item.id)).toEqual(['fresh', 'stale']);
    expect(ranked[0]?.components.freshness).toBe(1);
    expect(ranked[1]?.components.freshness ?? 1).toBeLessThan(0.1);
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it('lets an explicit decayAfter on the item override the kind default in both directions', () => {
    const patientFact = item({
      kind: 'fact',
      assertedAt: at(-100 * DAY_MS),
      decayAfter: 3650 * DAY_MS,
    });
    const impatientConstraint = item({
      kind: 'constraint',
      assertedAt: at(-100 * DAY_MS),
      decayAfter: DAY_MS,
    });

    expect(decayAfterFor(patientFact)).toBe(3650 * DAY_MS);
    expect(scoreComponents(patientFact, null, NOW).freshness).toBe(1);
    expect(decayAfterFor(impatientConstraint)).toBe(DAY_MS);
    expect(scoreComponents(impatientConstraint, null, NOW).freshness).toBeLessThan(0.01);
  });
});

describe('configurable decay defaults', () => {
  const neverStale: DecayDefaults = {
    decision: null,
    constraint: null,
    open_question: null,
    fact: null,
    artifact_ref: null,
  };
  const staleInADay: DecayDefaults = {
    decision: DAY_MS,
    constraint: DAY_MS,
    open_question: DAY_MS,
    fact: DAY_MS,
    artifact_ref: DAY_MS,
  };

  it('accepts a tuned map through scoreComponents', () => {
    const oldFact = item({ kind: 'fact', assertedAt: at(-400 * DAY_MS) });

    expect(scoreComponents(oldFact, null, NOW).freshness).toBeLessThan(1);
    expect(scoreComponents(oldFact, null, NOW, neverStale).freshness).toBe(1);
  });

  it('accepts a tuned map through scoreItems', () => {
    const items = [item({ id: 'aged', kind: 'decision', assertedAt: at(-30 * DAY_MS) })];

    const withDefaults = scoreItems({ items, taskEmbedding: null, now: NOW });
    const withOverride = scoreItems({
      items,
      taskEmbedding: null,
      now: NOW,
      decayDefaults: staleInADay,
    });

    expect(withDefaults[0]?.components.freshness).toBe(1);
    expect(withOverride[0]?.components.freshness ?? 1).toBeLessThan(0.01);
    expect(withOverride[0]?.score ?? 0).toBeLessThan(withDefaults[0]?.score ?? 0);
  });

  it('falls back to the shipped defaults when no map is supplied', () => {
    const aged = item({ kind: 'fact', assertedAt: at(-400 * DAY_MS) });
    const [scored] = scoreItems({ items: [aged], taskEmbedding: null, now: NOW });

    expect(scored?.components.freshness).toBe(
      scoreComponents(aged, null, NOW, DEFAULT_DECAY_AFTER_BY_KIND).freshness,
    );
  });
});

describe('GUARD §10.2: the freshness term cannot drop a load-bearing constraint', () => {
  const punishing: DecayDefaults = {
    decision: 1,
    constraint: 1,
    open_question: 1,
    fact: 1,
    artifact_ref: 1,
  };

  const decayedConstraint = item({
    id: '00000000-0000-4000-8000-0000000000c0',
    kind: 'constraint',
    title: 'no downtime window; the cutover must be online',
    loadBearing: true,
    status: 'active',
    confidence: 0.1,
    assertedAt: at(-3650 * DAY_MS),
    lastVerifiedAt: at(-3650 * DAY_MS),
    decayAfter: 1,
  });

  it('scores the decayed constraint at the floor of the freshness term', () => {
    const components = scoreComponents(decayedConstraint, null, NOW, punishing);

    expect(components.freshness).toBeLessThan(0.000001);
    expect(components.loadBearing).toBe(1);
    expect(isMandatoryItem(decayedConstraint)).toBe(true);
  });

  it('still packs it when it ranks last and the budget holds nothing else', () => {
    const competitors = ITEM_KINDS.filter((kind) => kind !== 'constraint').map((kind, index) =>
      item({
        id: `00000000-0000-4000-8000-00000000000${index}`,
        kind,
        title: `a fresh ${kind} that would otherwise win the budget`,
        humanConfirmed: true,
        confidence: 1,
        assertedAt: NOW,
      }),
    );

    const scored = scoreItems({
      items: [...competitors, decayedConstraint],
      taskEmbedding: null,
      now: NOW,
      decayDefaults: punishing,
    });

    expect(scored[scored.length - 1]?.item.id).toBe(decayedConstraint.id);

    const slice = packSlice({ scored, tokenBudget: 0 });

    expect(slice.mandatoryItemIds).toEqual([decayedConstraint.id]);
    expect(slice.items.map((entry) => entry.item.id)).toEqual([decayedConstraint.id]);
    expect(slice.droppedItemIds).not.toContain(decayedConstraint.id);
  });

  it('keeps it in the slice across every budget from zero upward', () => {
    const noise = Array.from({ length: 12 }, (_, index) =>
      item({
        id: `00000000-0000-4000-8000-1000000000${String(index).padStart(2, '0')}`,
        kind: 'fact',
        title: `a fresh fact competing for the budget, number ${index}`,
        humanConfirmed: true,
        confidence: 1,
        assertedAt: NOW,
      }),
    );
    const scored = scoreItems({
      items: [...noise, decayedConstraint],
      taskEmbedding: null,
      now: NOW,
      decayDefaults: punishing,
    });

    for (const tokenBudget of [0, 1, 5, 25, 100, 4000]) {
      const slice = packSlice({ scored, tokenBudget });

      expect(slice.items.map((entry) => entry.item.id)).toContain(decayedConstraint.id);
      expect(slice.droppedItemIds).not.toContain(decayedConstraint.id);
    }
  });
});
