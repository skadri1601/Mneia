import type { ContextItem, Uuid } from '../../domain/types.js';
import {
  candidateLimitFor,
  MANDATORY_ITEM_LIMIT,
  mergeCandidates,
  RECENT_SUPERSEDED_LIMIT,
} from '../assemble.js';
import { isMandatoryItem, packSlice } from '../pack.js';
import { scoreItems, semanticRelevance } from '../score.js';
import type { ScoredItem } from '../types.js';
import { GOLDEN_CORPUS } from './corpus.js';
import { GOLDEN_TASKS } from './tasks.js';
import type {
  EvalComparison,
  EvalConfig,
  EvalOptions,
  EvalReport,
  GoldenCorpus,
  GoldenTask,
  LoadBearingCheck,
  MetricDelta,
  MetricsDelta,
  RelevanceGrade,
  TaskMetrics,
  TaskMovement,
  TaskResult,
} from './types.js';
import { TASK_METRIC_NAMES } from './types.js';

export const NDCG_CUTOFF = 10;

const SUPERSEDED_KINDS = new Set(['decision', 'constraint']);

const ROUNDING_SCALE = 1000000;

const rounded = (value: number): number => Math.round(value * ROUNDING_SCALE) / ROUNDING_SCALE;

const byIdAscending = (left: ContextItem, right: ContextItem): number => {
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
};

function isVisibleAt(item: ContextItem, now: Date): boolean {
  if (item.validFrom.getTime() > now.getTime()) {
    return false;
  }
  return item.validTo === null || item.validTo.getTime() > now.getTime();
}

function selectCandidates(
  corpus: GoldenCorpus,
  task: GoldenTask,
  tokenBudget: number,
): readonly ContextItem[] {
  const visible = corpus.items.filter((item) => isVisibleAt(item, corpus.now));
  const active = visible.filter((item) => item.status === 'active');

  const ranked = [...active].sort((left, right) => {
    const leftScore = semanticRelevance(left.embedding, task.taskEmbedding);
    const rightScore = semanticRelevance(right.embedding, task.taskEmbedding);
    return rightScore === leftScore ? byIdAscending(left, right) : rightScore - leftScore;
  });

  const candidates = ranked.slice(0, candidateLimitFor(tokenBudget));

  const mandatory = active
    .filter((item) => isMandatoryItem(item))
    .sort(byIdAscending)
    .slice(0, MANDATORY_ITEM_LIMIT);

  const superseded = visible
    .filter((item) => item.status === 'superseded' && SUPERSEDED_KINDS.has(item.kind))
    .sort((left, right) => {
      const delta = right.assertedAt.getTime() - left.assertedAt.getTime();
      return delta === 0 ? byIdAscending(left, right) : delta;
    })
    .slice(0, RECENT_SUPERSEDED_LIMIT);

  return mergeCandidates(mandatory, superseded, candidates);
}

function gradeOf(task: GoldenTask, id: Uuid): RelevanceGrade {
  return task.relevance[id] ?? 0;
}

function discountedGain(grades: readonly RelevanceGrade[]): number {
  return grades.reduce<number>(
    (sum, grade, index) => sum + (2 ** grade - 1) / Math.log2(index + 2),
    0,
  );
}

function ndcg(task: GoldenTask, ranking: readonly Uuid[]): number {
  const actual = discountedGain(ranking.slice(0, NDCG_CUTOFF).map((id) => gradeOf(task, id)));
  const ideal = discountedGain(
    Object.values(task.relevance)
      .filter((grade) => grade > 0)
      .sort((left, right) => right - left)
      .slice(0, NDCG_CUTOFF),
  );
  return ideal === 0 ? 0 : actual / ideal;
}

function intendedTopMatch(task: GoldenTask, ranking: readonly Uuid[]): number {
  if (task.intendedTop.length === 0) {
    return 1;
  }
  const matched = task.intendedTop.filter((id, index) => ranking[index] === id).length;
  return matched / task.intendedTop.length;
}

function checkLoadBearing(
  candidates: readonly ContextItem[],
  sliceIds: ReadonlySet<Uuid>,
): LoadBearingCheck {
  const requiredIds = candidates
    .filter((item) => isMandatoryItem(item))
    .map((item) => item.id)
    .sort();
  const includedIds = requiredIds.filter((id) => sliceIds.has(id));
  const missingIds = requiredIds.filter((id) => !sliceIds.has(id));
  return {
    requiredIds,
    includedIds,
    missingIds,
    satisfied: missingIds.length === 0,
  };
}

function metricsFor(
  task: GoldenTask,
  ranking: readonly Uuid[],
  sliceIds: readonly Uuid[],
): TaskMetrics {
  const included = new Set(sliceIds);
  const relevantIds = Object.keys(task.relevance).filter((id) => gradeOf(task, id) > 0);
  const mustHaveIds = Object.keys(task.relevance).filter((id) => gradeOf(task, id) === 2);

  const hits = sliceIds.filter((id) => gradeOf(task, id) > 0).length;
  const mustHaveHits = mustHaveIds.filter((id) => included.has(id)).length;

  return {
    precision: rounded(sliceIds.length === 0 ? 0 : hits / sliceIds.length),
    recall: rounded(relevantIds.length === 0 ? 0 : hits / relevantIds.length),
    mustHaveRecall: rounded(mustHaveIds.length === 0 ? 1 : mustHaveHits / mustHaveIds.length),
    ndcgAtTen: rounded(ndcg(task, ranking)),
    intendedTopMatch: rounded(intendedTopMatch(task, ranking)),
  };
}

function meanMetrics(results: readonly TaskResult[]): TaskMetrics {
  const mean = (pick: (metrics: TaskMetrics) => number): number =>
    results.length === 0
      ? 0
      : rounded(results.reduce((sum, result) => sum + pick(result.metrics), 0) / results.length);

  return {
    precision: mean((metrics) => metrics.precision),
    recall: mean((metrics) => metrics.recall),
    mustHaveRecall: mean((metrics) => metrics.mustHaveRecall),
    ndcgAtTen: mean((metrics) => metrics.ndcgAtTen),
    intendedTopMatch: mean((metrics) => metrics.intendedTopMatch),
  };
}

function runTask(corpus: GoldenCorpus, task: GoldenTask, config: EvalConfig): TaskResult {
  const tokenBudget = config.tokenBudget ?? task.tokenBudget;
  const candidates = selectCandidates(corpus, task, tokenBudget);

  const scored: readonly ScoredItem[] = scoreItems({
    items: candidates,
    taskEmbedding: task.taskEmbedding,
    now: corpus.now,
    weights: config.weights,
    ...(config.decayDefaults === undefined ? {} : { decayDefaults: config.decayDefaults }),
  });

  const packed = packSlice({
    scored,
    tokenBudget,
    ...(config.quotas === undefined ? {} : { quotas: config.quotas }),
  });

  const ranking = scored.map((entry) => entry.item.id);
  const sliceItemIds = packed.items.map((entry) => entry.item.id);
  const included = new Set(sliceItemIds);

  const missingRelevantIds = Object.keys(task.relevance)
    .filter((id) => gradeOf(task, id) > 0 && !included.has(id))
    .sort();
  const unexpectedIds = sliceItemIds.filter((id) => gradeOf(task, id) === 0).sort();

  return {
    taskId: task.id,
    metrics: metricsFor(task, ranking, sliceItemIds),
    rankedTopTen: ranking.slice(0, NDCG_CUTOFF),
    sliceItemIds,
    missingRelevantIds,
    unexpectedIds,
    tokensUsed: packed.tokensUsed,
    tokenBudget: packed.tokenBudget,
    overflowTokens: Math.max(0, packed.tokensUsed - packed.tokenBudget),
    loadBearing: checkLoadBearing(candidates, included),
  };
}

export function describeLoadBearingFailure(report: EvalReport): string {
  const detail = report.tasks
    .filter((result) => !result.loadBearing.satisfied)
    .map(
      (result) =>
        `${result.taskId} dropped ${result.loadBearing.missingIds.join(', ')} at a budget of ${result.tokenBudget} tokens`,
    )
    .join('; ');
  return `configuration "${report.label}" dropped an active load_bearing constraint from a slice, which vision.md §10.2 forbids at any score or budget: ${detail}. Restore the guarantee in the packer rather than retuning weights — no retrieval metric offsets a dropped constraint.`;
}

export function assertLoadBearingSatisfied(report: EvalReport): void {
  if (!report.loadBearingSatisfied) {
    throw new Error(describeLoadBearingFailure(report));
  }
}

export function runEval(
  config: EvalConfig,
  options: EvalOptions = {},
  corpus: GoldenCorpus = GOLDEN_CORPUS,
  tasks: readonly GoldenTask[] = GOLDEN_TASKS,
): EvalReport {
  const results = tasks.map((task) => runTask(corpus, task, config));
  const failed = results.filter((result) => !result.loadBearing.satisfied);

  const report: EvalReport = {
    label: config.label,
    corpusId: corpus.id,
    taskCount: results.length,
    candidateCount: corpus.items.length,
    tasks: results,
    aggregate: meanMetrics(results),
    loadBearingSatisfied: failed.length === 0,
    loadBearingFailedTaskIds: failed.map((result) => result.taskId),
  };

  if (options.strict !== false) {
    assertLoadBearingSatisfied(report);
  }

  return report;
}

function deltaOf(a: number, b: number): MetricDelta {
  return { a, b, delta: rounded(b - a) };
}

function metricsDelta(a: TaskMetrics, b: TaskMetrics): MetricsDelta {
  return {
    precision: deltaOf(a.precision, b.precision),
    recall: deltaOf(a.recall, b.recall),
    mustHaveRecall: deltaOf(a.mustHaveRecall, b.mustHaveRecall),
    ndcgAtTen: deltaOf(a.ndcgAtTen, b.ndcgAtTen),
    intendedTopMatch: deltaOf(a.intendedTopMatch, b.intendedTopMatch),
  };
}

const sameOrder = (left: readonly Uuid[], right: readonly Uuid[]): boolean =>
  left.length === right.length && left.every((id, index) => right[index] === id);

const movedAtAll = (delta: MetricsDelta, movement: Omit<TaskMovement, 'metrics' | 'taskId'>) =>
  movement.rankingChanged ||
  movement.sliceChanged ||
  TASK_METRIC_NAMES.some((name) => delta[name].delta !== 0);

export function compareEvals(a: EvalReport, b: EvalReport): EvalComparison {
  const byTaskId = new Map(b.tasks.map((result) => [result.taskId, result]));

  const movedTasks: TaskMovement[] = [];
  const unchangedTaskIds: string[] = [];
  const loadBearingRegressedTaskIds: string[] = [];
  const loadBearingRecoveredTaskIds: string[] = [];

  for (const left of a.tasks) {
    const right = byTaskId.get(left.taskId);
    if (right === undefined) {
      throw new Error(
        `task "${left.taskId}" is present in report "${a.label}" but absent from "${b.label}"; both reports must be run over the same golden task set to be comparable`,
      );
    }

    if (left.loadBearing.satisfied && !right.loadBearing.satisfied) {
      loadBearingRegressedTaskIds.push(left.taskId);
    }
    if (!left.loadBearing.satisfied && right.loadBearing.satisfied) {
      loadBearingRecoveredTaskIds.push(left.taskId);
    }

    const leftSlice = new Set(left.sliceItemIds);
    const rightSlice = new Set(right.sliceItemIds);
    const delta = metricsDelta(left.metrics, right.metrics);
    const shape = {
      rankingChanged: !sameOrder(left.rankedTopTen, right.rankedTopTen),
      sliceChanged: !sameOrder([...leftSlice].sort(), [...rightSlice].sort()),
      enteredSliceIds: right.sliceItemIds.filter((id) => !leftSlice.has(id)).sort(),
      leftSliceIds: left.sliceItemIds.filter((id) => !rightSlice.has(id)).sort(),
    };

    if (movedAtAll(delta, shape)) {
      movedTasks.push({ taskId: left.taskId, metrics: delta, ...shape });
    } else {
      unchangedTaskIds.push(left.taskId);
    }
  }

  return {
    a: a.label,
    b: b.label,
    aggregate: metricsDelta(a.aggregate, b.aggregate),
    movedTasks,
    unchangedTaskIds,
    loadBearingRegressedTaskIds,
    loadBearingRecoveredTaskIds,
  };
}
