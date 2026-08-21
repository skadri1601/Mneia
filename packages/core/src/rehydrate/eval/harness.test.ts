import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING_WEIGHTS } from '../score.js';
import {
  LOAD_BEARING_CONSTRAINT_SLUGS,
  RECORDED_COMPARISON_DELTAS,
  RECORDED_DEFAULT,
  RECORDED_SEMANTIC_HEAVY_AGGREGATE,
  SEMANTIC_HEAVY_WEIGHTS,
} from './baseline.js';
import { GOLDEN_CORPUS, slugOf } from './corpus.js';
import { assertLoadBearingSatisfied, compareEvals, runEval } from './harness.js';
import { GOLDEN_TASKS } from './tasks.js';
import { TASK_METRIC_NAMES } from './types.js';

const DEFAULT_CONFIG = { label: RECORDED_DEFAULT.label, weights: DEFAULT_SCORING_WEIGHTS };
const SEMANTIC_HEAVY_CONFIG = { label: 'semantic-heavy', weights: SEMANTIC_HEAVY_WEIGHTS };

describe('the golden corpus', () => {
  it('is deterministic and needs no clock, no database, and no embedding provider', () => {
    expect(GOLDEN_CORPUS.now.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(GOLDEN_CORPUS.items).toHaveLength(40);
    expect(GOLDEN_CORPUS.items.every((item) => item.embedding !== null)).toBe(true);
    expect(new Set(GOLDEN_CORPUS.items.map((item) => item.id)).size).toBe(
      GOLDEN_CORPUS.items.length,
    );
  });

  it('carries the shapes a ranking change can break', () => {
    const kinds = new Set(GOLDEN_CORPUS.items.map((item) => item.kind));
    const statuses = new Set(GOLDEN_CORPUS.items.map((item) => item.status));

    expect([...kinds].sort()).toEqual([
      'artifact_ref',
      'constraint',
      'decision',
      'fact',
      'open_question',
    ]);
    expect([...statuses].sort()).toEqual(['active', 'disputed', 'retired', 'superseded']);
    expect(
      GOLDEN_CORPUS.items
        .filter(
          (item) => item.loadBearing && item.status === 'active' && item.kind === 'constraint',
        )
        .map((item) => slugOf(item.id))
        .sort(),
    ).toEqual([...LOAD_BEARING_CONSTRAINT_SLUGS]);
  });

  it('names every task item it is asked for', () => {
    const known = new Set(GOLDEN_CORPUS.items.map((item) => item.id));
    for (const task of GOLDEN_TASKS) {
      for (const id of Object.keys(task.relevance)) {
        expect(known.has(id)).toBe(true);
      }
      for (const id of task.intendedTop) {
        expect(task.relevance[id]).toBeGreaterThan(0);
      }
    }
  });
});

describe('runEval against DEFAULT_SCORING_WEIGHTS', () => {
  const report = runEval(DEFAULT_CONFIG);

  it('reproduces the recorded aggregate', () => {
    expect(report.aggregate).toEqual(RECORDED_DEFAULT.aggregate);
  });

  it('reproduces the recorded per-task numbers', () => {
    for (const result of report.tasks) {
      const recorded = RECORDED_DEFAULT.tasks[result.taskId];
      expect(recorded, `no baseline recorded for task "${result.taskId}"`).toBeDefined();
      expect({
        metrics: result.metrics,
        sliceSize: result.sliceItemIds.length,
        tokensUsed: result.tokensUsed,
        tokenBudget: result.tokenBudget,
        overflowTokens: result.overflowTokens,
        rankedTopFive: result.rankedTopTen.slice(0, 5).map(slugOf),
      }).toEqual(recorded);
    }
  });

  it('returns the same report on a second run', () => {
    expect(runEval(DEFAULT_CONFIG)).toEqual(report);
  });
});

describe('the load-bearing guarantee', () => {
  it('holds for every golden task at the recorded budgets', () => {
    const report = runEval(DEFAULT_CONFIG);
    expect(report.loadBearingSatisfied).toBe(true);
    for (const result of report.tasks) {
      expect(result.loadBearing.missingIds).toEqual([]);
      expect(result.loadBearing.requiredIds).toHaveLength(LOAD_BEARING_CONSTRAINT_SLUGS.length);
    }
  });

  it('holds under a budget too small to hold one item, and overflows instead', () => {
    const report = runEval({ ...DEFAULT_CONFIG, label: 'starved', tokenBudget: 1 });
    expect(report.loadBearingSatisfied).toBe(true);
    for (const result of report.tasks) {
      expect(result.loadBearing.missingIds).toEqual([]);
      expect(result.overflowTokens).toBeGreaterThan(0);
    }
  });

  it('is a hard failure rather than a metric that averages away', () => {
    const report = runEval(DEFAULT_CONFIG);
    const dropped = report.tasks[0];
    expect(dropped).toBeDefined();
    if (dropped === undefined) {
      return;
    }

    const failing = {
      ...report,
      loadBearingSatisfied: false,
      loadBearingFailedTaskIds: [dropped.taskId],
      tasks: [
        {
          ...dropped,
          loadBearing: {
            ...dropped.loadBearing,
            missingIds: dropped.loadBearing.requiredIds,
            satisfied: false,
          },
        },
      ],
    };

    expect(() => assertLoadBearingSatisfied(failing)).toThrow(/load_bearing constraint/);
    expect(failing.aggregate.ndcgAtTen).toBeGreaterThan(0.7);
  });
});

describe('comparing two configurations', () => {
  it('reports the per-metric delta and which tasks moved', () => {
    const a = runEval(DEFAULT_CONFIG);
    const b = runEval(SEMANTIC_HEAVY_CONFIG);

    expect(b.aggregate).toEqual(RECORDED_SEMANTIC_HEAVY_AGGREGATE);

    const comparison = compareEvals(a, b);
    expect(comparison.a).toBe(RECORDED_DEFAULT.label);
    expect(comparison.b).toBe('semantic-heavy');

    for (const name of TASK_METRIC_NAMES) {
      expect(comparison.aggregate[name].delta).toBe(RECORDED_COMPARISON_DELTAS[name]);
    }

    expect(comparison.movedTasks.map((movement) => movement.taskId)).toEqual(
      GOLDEN_TASKS.map((task) => task.id),
    );
    expect(comparison.unchangedTaskIds).toEqual([]);
    expect(comparison.loadBearingRegressedTaskIds).toEqual([]);
  });

  it('reports no movement when a configuration is compared with itself', () => {
    const comparison = compareEvals(runEval(DEFAULT_CONFIG), runEval(DEFAULT_CONFIG));
    expect(comparison.movedTasks).toEqual([]);
    expect(comparison.unchangedTaskIds).toEqual(GOLDEN_TASKS.map((task) => task.id));
    for (const name of TASK_METRIC_NAMES) {
      expect(comparison.aggregate[name].delta).toBe(0);
    }
  });

  it('refuses to compare reports run over different task sets', () => {
    const a = runEval(DEFAULT_CONFIG);
    const partial = runEval(DEFAULT_CONFIG, {}, GOLDEN_CORPUS, GOLDEN_TASKS.slice(1));
    expect(() => compareEvals(a, partial)).toThrow(/same golden task set/);
  });
});
