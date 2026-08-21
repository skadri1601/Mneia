import type { ContextItem, Embedding, Uuid } from '../../domain/types.js';
import type { DecayDefaults, KindQuotas, ScoringWeights } from '../types.js';

export interface GoldenCorpus {
  readonly id: string;
  readonly now: Date;
  readonly embeddingModel: string;
  readonly construction: string;
  readonly items: readonly ContextItem[];
}

export type RelevanceGrade = 0 | 1 | 2;

export interface GoldenTask {
  readonly id: string;
  readonly task: string;
  readonly taskEmbedding: Embedding;
  readonly tokenBudget: number;
  readonly relevance: Readonly<Record<Uuid, RelevanceGrade>>;
  readonly intendedTop: readonly Uuid[];
  readonly groundTruth: string;
}

export interface EvalConfig {
  readonly label: string;
  readonly weights: ScoringWeights;
  readonly decayDefaults?: DecayDefaults | undefined;
  readonly quotas?: KindQuotas | undefined;
  readonly tokenBudget?: number | undefined;
}

export interface EvalOptions {
  readonly strict?: boolean | undefined;
}

export interface TaskMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly mustHaveRecall: number;
  readonly ndcgAtTen: number;
  readonly intendedTopMatch: number;
}

export const TASK_METRIC_NAMES = [
  'precision',
  'recall',
  'mustHaveRecall',
  'ndcgAtTen',
  'intendedTopMatch',
] as const;

export type TaskMetricName = (typeof TASK_METRIC_NAMES)[number];

export interface LoadBearingCheck {
  readonly requiredIds: readonly Uuid[];
  readonly includedIds: readonly Uuid[];
  readonly missingIds: readonly Uuid[];
  readonly satisfied: boolean;
}

export interface TaskResult {
  readonly taskId: string;
  readonly metrics: TaskMetrics;
  readonly rankedTopTen: readonly Uuid[];
  readonly sliceItemIds: readonly Uuid[];
  readonly missingRelevantIds: readonly Uuid[];
  readonly unexpectedIds: readonly Uuid[];
  readonly tokensUsed: number;
  readonly tokenBudget: number;
  readonly overflowTokens: number;
  readonly loadBearing: LoadBearingCheck;
}

export interface EvalReport {
  readonly label: string;
  readonly corpusId: string;
  readonly taskCount: number;
  readonly candidateCount: number;
  readonly tasks: readonly TaskResult[];
  readonly aggregate: TaskMetrics;
  readonly loadBearingSatisfied: boolean;
  readonly loadBearingFailedTaskIds: readonly string[];
}

export interface MetricDelta {
  readonly a: number;
  readonly b: number;
  readonly delta: number;
}

export type MetricsDelta = Readonly<Record<TaskMetricName, MetricDelta>>;

export interface TaskMovement {
  readonly taskId: string;
  readonly metrics: MetricsDelta;
  readonly rankingChanged: boolean;
  readonly sliceChanged: boolean;
  readonly enteredSliceIds: readonly Uuid[];
  readonly leftSliceIds: readonly Uuid[];
}

export interface EvalComparison {
  readonly a: string;
  readonly b: string;
  readonly aggregate: MetricsDelta;
  readonly movedTasks: readonly TaskMovement[];
  readonly unchangedTaskIds: readonly string[];
  readonly loadBearingRegressedTaskIds: readonly string[];
  readonly loadBearingRecoveredTaskIds: readonly string[];
}
