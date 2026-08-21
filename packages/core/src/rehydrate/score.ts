import type { ContextItem, Embedding, IntervalMs } from '../domain/types.js';
import type {
  DecayDefaults,
  ScoreComponents,
  ScoredItem,
  ScoringInput,
  ScoringWeights,
} from './types.js';

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  semanticRelevance: 0.3,
  recencyDecay: 0.15,
  confidence: 0.1,
  humanConfirmed: 0.15,
  loadBearing: 0.2,
  freshness: 0.1,
  disputed: 0.5,
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const RECENCY_HALF_LIFE_MS = 14 * DAY_MS;

export const DEFAULT_DECAY_AFTER_BY_KIND: DecayDefaults = {
  fact: 14 * DAY_MS,
  artifact_ref: 30 * DAY_MS,
  open_question: 90 * DAY_MS,
  decision: 365 * DAY_MS,
  constraint: null,
};

export const STALENESS_HALF_LIFE_RATIO = 1;

export const NEUTRAL_SEMANTIC_RELEVANCE = 0.5;

const clamp01 = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  return value > 1 ? 1 : value;
};

const halfLifeDecay = (elapsedMs: number, halfLifeMs: number): number => {
  if (elapsedMs <= 0) {
    return 1;
  }
  if (halfLifeMs <= 0) {
    return 0;
  }
  return clamp01(2 ** (-elapsedMs / halfLifeMs));
};

export function semanticRelevance(
  itemEmbedding: Embedding | null,
  taskEmbedding: Embedding | null,
): number {
  if (itemEmbedding === null || taskEmbedding === null) {
    return NEUTRAL_SEMANTIC_RELEVANCE;
  }
  if (itemEmbedding.length === 0 || taskEmbedding.length === 0) {
    return NEUTRAL_SEMANTIC_RELEVANCE;
  }
  if (itemEmbedding.length !== taskEmbedding.length) {
    throw new Error(
      `cannot compare an item embedding of ${itemEmbedding.length} dimensions with a task embedding of ${taskEmbedding.length}; both must come from the same embedding model — re-embed the stored items or query with the model they were written under`,
    );
  }

  let dot = 0;
  let itemNorm = 0;
  let taskNorm = 0;

  for (let index = 0; index < itemEmbedding.length; index += 1) {
    const itemValue = itemEmbedding[index] ?? 0;
    const taskValue = taskEmbedding[index] ?? 0;
    dot += itemValue * taskValue;
    itemNorm += itemValue * itemValue;
    taskNorm += taskValue * taskValue;
  }

  if (itemNorm === 0 || taskNorm === 0) {
    return NEUTRAL_SEMANTIC_RELEVANCE;
  }

  const cosine = dot / (Math.sqrt(itemNorm) * Math.sqrt(taskNorm));
  return Number.isFinite(cosine) ? clamp01(cosine) : NEUTRAL_SEMANTIC_RELEVANCE;
}

export function recencyDecay(
  assertedAt: Date,
  now: Date,
  halfLifeMs: number = RECENCY_HALF_LIFE_MS,
): number {
  return halfLifeDecay(now.getTime() - assertedAt.getTime(), halfLifeMs);
}

export function freshness(
  lastVerifiedAt: Date | null,
  assertedAt: Date,
  decayAfter: IntervalMs | null,
  now: Date,
): number {
  if (decayAfter === null) {
    return 1;
  }

  const verifiedAt = lastVerifiedAt ?? assertedAt;
  const elapsed = now.getTime() - verifiedAt.getTime();

  if (elapsed <= decayAfter) {
    return 1;
  }

  return halfLifeDecay(elapsed - decayAfter, decayAfter * STALENESS_HALF_LIFE_RATIO);
}

export function decayAfterFor(
  item: ContextItem,
  defaults: DecayDefaults = DEFAULT_DECAY_AFTER_BY_KIND,
): IntervalMs | null {
  return item.decayAfter ?? defaults[item.kind];
}

export function scoreComponents(
  item: ContextItem,
  taskEmbedding: Embedding | null,
  now: Date,
  decayDefaults: DecayDefaults = DEFAULT_DECAY_AFTER_BY_KIND,
  precomputedRelevance?: number,
): ScoreComponents {
  return {
    semanticRelevance:
      precomputedRelevance === undefined
        ? semanticRelevance(item.embedding, taskEmbedding)
        : clamp01(precomputedRelevance),
    recencyDecay: recencyDecay(item.assertedAt, now),
    confidence: clamp01(item.confidence),
    humanConfirmed: item.humanConfirmed ? 1 : 0,
    loadBearing: item.loadBearing ? 1 : 0,
    freshness: freshness(
      item.lastVerifiedAt,
      item.assertedAt,
      decayAfterFor(item, decayDefaults),
      now,
    ),
    disputed: item.status === 'disputed' ? 1 : 0,
  };
}

export function totalScore(
  components: ScoreComponents,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): number {
  return (
    weights.semanticRelevance * components.semanticRelevance +
    weights.recencyDecay * components.recencyDecay +
    weights.confidence * components.confidence +
    weights.humanConfirmed * components.humanConfirmed +
    weights.loadBearing * components.loadBearing +
    weights.freshness * components.freshness -
    weights.disputed * components.disputed
  );
}

const byScoreThenId = (left: ScoredItem, right: ScoredItem): number => {
  if (right.score !== left.score) {
    return right.score - left.score;
  }
  if (left.item.id === right.item.id) {
    return 0;
  }
  return left.item.id < right.item.id ? -1 : 1;
};

export function scoreItems(input: ScoringInput): readonly ScoredItem[] {
  const weights = input.weights ?? DEFAULT_SCORING_WEIGHTS;
  const decayDefaults = input.decayDefaults ?? DEFAULT_DECAY_AFTER_BY_KIND;

  const scored = input.items.map((item): ScoredItem => {
    const components = scoreComponents(
      item,
      input.taskEmbedding,
      input.now,
      decayDefaults,
      input.relevance?.get(item.id),
    );
    return { item, score: totalScore(components, weights), components };
  });

  return scored.sort(byScoreThenId);
}
