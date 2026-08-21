import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTRADICTION_EVAL_CASES } from './cases.js';
import type { ClassScore, ConfusionMatrix } from './score.js';
import { EVAL_VERDICTS, formatEvalReport, scoreEvalSet } from './score.js';

interface Baseline {
  readonly total: number;
  readonly exactMatches: number;
  readonly contradiction: ClassScore;
  readonly confusion: ConfusionMatrix;
  readonly verdicts: Readonly<Record<string, string>>;
}

const baseline = JSON.parse(
  readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'),
) as Baseline;

const MOVED =
  'The recorded numbers in packages/core/src/extract/eval/baseline.json no longer describe the classifier. If the move is intended, regenerate the file in the same commit so a reviewer sees precision and recall change in the diff.';

describe('the contradiction eval set', () => {
  it('gives every case a unique id', () => {
    const ids = CONTRADICTION_EVAL_CASES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says why every case is labelled the way it is', () => {
    for (const entry of CONTRADICTION_EVAL_CASES) {
      expect(entry.why.length, `${entry.id} carries no explanation`).toBeGreaterThan(40);
      expect(EVAL_VERDICTS).toContain(entry.expected);
    }
  });

  it('carries both genuine contradictions and near misses that must not fire', () => {
    const contradictions = CONTRADICTION_EVAL_CASES.filter(
      (entry) => entry.expected === 'contradiction',
    );
    const nearMisses = CONTRADICTION_EVAL_CASES.filter(
      (entry) => entry.expected !== 'contradiction',
    );

    expect(contradictions.length).toBeGreaterThanOrEqual(10);
    expect(nearMisses.length).toBeGreaterThanOrEqual(10);
  });

  it('scores the same numbers twice in a row', () => {
    expect(scoreEvalSet()).toEqual(scoreEvalSet());
  });
});

describe('the recorded baseline', () => {
  const report = scoreEvalSet();

  it('still matches the measured precision and recall for the contradiction class', () => {
    expect(report.contradiction, `${MOVED}\n\n${formatEvalReport(report)}`).toEqual(
      baseline.contradiction,
    );
  });

  it('still matches the recorded confusion matrix', () => {
    expect(report.confusion, `${MOVED}\n\n${formatEvalReport(report)}`).toEqual(baseline.confusion);
    expect(report.total).toBe(baseline.total);
    expect(report.exactMatches).toBe(baseline.exactMatches);
  });

  it('still returns the recorded verdict for every named case', () => {
    const verdicts = Object.fromEntries(
      report.outcomes.map((outcome) => [outcome.id, outcome.actual]),
    );
    expect(verdicts, MOVED).toEqual(baseline.verdicts);
  });
});
