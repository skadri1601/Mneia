import type { ScoringWeights } from '../types.js';
import type { TaskMetrics } from './types.js';

export interface RecordedTask {
  readonly metrics: TaskMetrics;
  readonly sliceSize: number;
  readonly tokensUsed: number;
  readonly tokenBudget: number;
  readonly overflowTokens: number;
  readonly rankedTopFive: readonly string[];
}

export interface RecordedRun {
  readonly label: string;
  readonly aggregate: TaskMetrics;
  readonly tasks: Readonly<Record<string, RecordedTask>>;
}

export const LOAD_BEARING_CONSTRAINT_SLUGS = [
  'c-dual-read-14d',
  'c-idempotency-namespaced',
  'c-no-downtime',
  'c-node-20',
  'c-pii-never-logged',
  'c-rls-mandatory',
] as const;

export const RECORDED_DEFAULT: RecordedRun = {
  label: 'DEFAULT_SCORING_WEIGHTS',
  aggregate: {
    precision: 0.434199,
    recall: 0.9,
    mustHaveRecall: 1,
    ndcgAtTen: 0.751984,
    intendedTopMatch: 0.25,
  },
  tasks: {
    'payments-retry-path': {
      metrics: {
        precision: 0.619048,
        recall: 1,
        mustHaveRecall: 1,
        ndcgAtTen: 0.737827,
        intendedTopMatch: 0,
      },
      sliceSize: 21,
      tokensUsed: 797,
      tokenBudget: 800,
      overflowTokens: 0,
      rankedTopFive: [
        'c-dual-read-14d',
        'c-idempotency-namespaced',
        'c-no-downtime',
        'c-pii-never-logged',
        'c-rls-mandatory',
      ],
    },
    'workspace-index-migration': {
      metrics: {
        precision: 0.47619,
        recall: 1,
        mustHaveRecall: 1,
        ndcgAtTen: 0.812903,
        intendedTopMatch: 0.25,
      },
      sliceSize: 21,
      tokensUsed: 798,
      tokenBudget: 800,
      overflowTokens: 0,
      rankedTopFive: [
        'c-rls-mandatory',
        'c-dual-read-14d',
        'd-direct-connection-migrations',
        'c-no-downtime',
        'd-neon-postgres',
      ],
    },
    'metered-billing': {
      metrics: {
        precision: 0.333333,
        recall: 1,
        mustHaveRecall: 1,
        ndcgAtTen: 0.80175,
        intendedTopMatch: 0.25,
      },
      sliceSize: 21,
      tokensUsed: 793,
      tokenBudget: 800,
      overflowTokens: 0,
      rankedTopFive: [
        'c-pii-never-logged',
        'c-dual-read-14d',
        'c-idempotency-namespaced',
        'c-no-downtime',
        'd-stripe-billing',
      ],
    },
    'workspace-settings-page': {
      metrics: {
        precision: 0.333333,
        recall: 0.5,
        mustHaveRecall: 1,
        ndcgAtTen: 0.718404,
        intendedTopMatch: 0.25,
      },
      sliceSize: 9,
      tokensUsed: 386,
      tokenBudget: 400,
      overflowTokens: 0,
      rankedTopFive: [
        'c-rls-mandatory',
        'c-pii-never-logged',
        'c-dual-read-14d',
        'c-idempotency-namespaced',
        'c-no-downtime',
      ],
    },
    'release-cut': {
      metrics: {
        precision: 0.409091,
        recall: 1,
        mustHaveRecall: 1,
        ndcgAtTen: 0.689036,
        intendedTopMatch: 0.5,
      },
      sliceSize: 22,
      tokensUsed: 800,
      tokenBudget: 800,
      overflowTokens: 0,
      rankedTopFive: [
        'c-no-downtime',
        'c-node-20',
        'c-dual-read-14d',
        'c-rls-mandatory',
        'c-idempotency-namespaced',
      ],
    },
  },
};

export const SEMANTIC_HEAVY_WEIGHTS: ScoringWeights = {
  semanticRelevance: 0.6,
  recencyDecay: 0.05,
  confidence: 0.1,
  humanConfirmed: 0.15,
  loadBearing: 0.2,
  freshness: 0.1,
  disputed: 0.5,
};

export const RECORDED_SEMANTIC_HEAVY_AGGREGATE: TaskMetrics = {
  precision: 0.434199,
  recall: 0.9,
  mustHaveRecall: 1,
  ndcgAtTen: 0.858779,
  intendedTopMatch: 0.35,
};

export const RECORDED_COMPARISON_DELTAS: Readonly<Record<keyof TaskMetrics, number>> = {
  precision: 0,
  recall: 0,
  mustHaveRecall: 0,
  ndcgAtTen: 0.106795,
  intendedTopMatch: 0.1,
};
