import type { ContradictionSignal, ReconcileOptions, ReconcileVerdict } from '../reconcile.js';
import { reconcileCandidates } from '../reconcile.js';
import type { EvalCase, EvalFamily } from './cases.js';
import { CONTRADICTION_EVAL_CASES } from './cases.js';

export const EVAL_VERDICTS = ['novel', 'duplicate', 'contradiction'] as const;

export interface EvalOutcome {
  readonly id: string;
  readonly family: EvalFamily;
  readonly expected: ReconcileVerdict;
  readonly actual: ReconcileVerdict;
  readonly passed: boolean;
  readonly matchedItemId: string | null;
  readonly signal: ContradictionSignal | null;
  readonly subjectSimilarity: number | null;
  readonly why: string;
}

export interface ClassScore {
  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
}

export type ConfusionMatrix = Readonly<
  Record<ReconcileVerdict, Readonly<Record<ReconcileVerdict, number>>>
>;

export interface EvalReport {
  readonly total: number;
  readonly exactMatches: number;
  readonly contradiction: ClassScore;
  readonly confusion: ConfusionMatrix;
  readonly outcomes: readonly EvalOutcome[];
  readonly failures: readonly EvalOutcome[];
}

const round = (value: number): number => Number(value.toFixed(4));

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : round(numerator / denominator);

function judgeOne(entry: EvalCase, options: ReconcileOptions | undefined): EvalOutcome {
  const result = reconcileCandidates(
    options === undefined
      ? { candidates: [entry.candidate], existing: entry.existing }
      : { candidates: [entry.candidate], existing: entry.existing, options },
  );
  const [reconciled] = result.all;

  if (reconciled === undefined) {
    throw new Error(
      `expected reconcileCandidates to return one verdict for eval case ${entry.id}; received none — the harness feeds exactly one candidate per case, so a missing verdict means reconcileCandidates dropped it`,
    );
  }

  return {
    id: entry.id,
    family: entry.family,
    expected: entry.expected,
    actual: reconciled.verdict,
    passed: reconciled.verdict === entry.expected,
    matchedItemId: reconciled.evidence?.matchedItemId ?? null,
    signal: reconciled.evidence?.signal ?? null,
    subjectSimilarity: reconciled.evidence?.subjectSimilarity ?? null,
    why: entry.why,
  };
}

function confusionOf(outcomes: readonly EvalOutcome[]): ConfusionMatrix {
  const counts = new Map<string, number>();
  for (const expected of EVAL_VERDICTS) {
    for (const actual of EVAL_VERDICTS) {
      counts.set(`${expected}:${actual}`, 0);
    }
  }
  for (const outcome of outcomes) {
    const key = `${outcome.expected}:${outcome.actual}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const read = (expected: ReconcileVerdict, actual: ReconcileVerdict): number =>
    counts.get(`${expected}:${actual}`) ?? 0;

  const row = (expected: ReconcileVerdict): Readonly<Record<ReconcileVerdict, number>> => ({
    novel: read(expected, 'novel'),
    duplicate: read(expected, 'duplicate'),
    contradiction: read(expected, 'contradiction'),
  });

  return { novel: row('novel'), duplicate: row('duplicate'), contradiction: row('contradiction') };
}

function scoreClass(outcomes: readonly EvalOutcome[], target: ReconcileVerdict): ClassScore {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  for (const outcome of outcomes) {
    if (outcome.actual === target && outcome.expected === target) {
      truePositives += 1;
    } else if (outcome.actual === target) {
      falsePositives += 1;
    } else if (outcome.expected === target) {
      falseNegatives += 1;
    }
  }

  const precision = ratio(truePositives, truePositives + falsePositives);
  const recall = ratio(truePositives, truePositives + falseNegatives);

  return {
    truePositives,
    falsePositives,
    falseNegatives,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : round((2 * precision * recall) / (precision + recall)),
  };
}

export interface ScoreEvalSetInput {
  readonly cases?: readonly EvalCase[];
  readonly options?: ReconcileOptions;
}

export function scoreEvalSet(input: ScoreEvalSetInput = {}): EvalReport {
  const cases = input.cases ?? CONTRADICTION_EVAL_CASES;
  const outcomes = cases.map((entry) => judgeOne(entry, input.options));

  return {
    total: outcomes.length,
    exactMatches: outcomes.filter((outcome) => outcome.passed).length,
    contradiction: scoreClass(outcomes, 'contradiction'),
    confusion: confusionOf(outcomes),
    outcomes,
    failures: outcomes.filter((outcome) => !outcome.passed),
  };
}

export function formatEvalReport(report: EvalReport): string {
  const { contradiction: score, confusion } = report;
  const lines = [
    `cases ${report.total} · exact ${report.exactMatches}/${report.total}`,
    `contradiction precision ${score.precision} recall ${score.recall} f1 ${score.f1}`,
    `contradiction tp ${score.truePositives} fp ${score.falsePositives} fn ${score.falseNegatives}`,
    'confusion (rows expected, columns actual): novel duplicate contradiction',
  ];

  for (const expected of EVAL_VERDICTS) {
    const row = confusion[expected];
    lines.push(`  ${expected.padEnd(13)} ${row.novel} ${row.duplicate} ${row.contradiction}`);
  }

  for (const outcome of report.outcomes) {
    lines.push(
      `${outcome.passed ? 'pass' : 'FAIL'} ${outcome.id} expected=${outcome.expected} actual=${outcome.actual} signal=${outcome.signal ?? 'none'} similarity=${outcome.subjectSimilarity ?? 'none'}`,
    );
  }

  return lines.join('\n');
}
