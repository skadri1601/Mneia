import type { ItemKind } from '../store/schema.js';
import type { ExtractionCandidate } from './schema.js';
import { ExtractionError } from './schema.js';
import type { Stance } from './similarity.js';
import {
  jaccard,
  numericLiterals,
  sameNumbers,
  sharedTokens,
  stanceOf,
  subjectTokens,
} from './similarity.js';

export const DEFAULT_DUPLICATE_SIMILARITY = 0.7;
export const DEFAULT_CONTRADICTION_SIMILARITY = 0.4;

export type ReconcileVerdict = 'novel' | 'duplicate' | 'contradiction';

export type ContradictionSignal = 'stance_flip' | 'value_conflict';

export interface ExistingItemSnapshot {
  readonly id: string;
  readonly kind: ItemKind;
  readonly title: string;
  readonly body?: string | null;
}

export interface ReconcileEvidence {
  readonly matchedItemId: string;
  readonly matchedTitle: string;
  readonly subjectSimilarity: number;
  readonly sharedSubjectTokens: readonly string[];
  readonly candidateStance: Stance;
  readonly existingStance: Stance;
  readonly candidateNumbers: readonly string[];
  readonly existingNumbers: readonly string[];
  readonly signal: ContradictionSignal | null;
}

export interface ReconciledCandidate {
  readonly index: number;
  readonly candidate: ExtractionCandidate;
  readonly verdict: ReconcileVerdict;
  readonly evidence: ReconcileEvidence | null;
  readonly reason: string | null;
}

export interface ReconcileResult {
  readonly novel: readonly ReconciledCandidate[];
  readonly duplicates: readonly ReconciledCandidate[];
  readonly contradictions: readonly ReconciledCandidate[];
  readonly all: readonly ReconciledCandidate[];
}

export interface ReconcileOptions {
  readonly duplicateSimilarity?: number | undefined;
  readonly contradictionSimilarity?: number | undefined;
}

export interface ReconcileRequest {
  readonly candidates: readonly ExtractionCandidate[];
  readonly existing: readonly ExistingItemSnapshot[];
  readonly options?: ReconcileOptions;
}

interface Indexed {
  readonly item: ExistingItemSnapshot;
  readonly tokens: ReadonlySet<string>;
  readonly stance: Stance;
  readonly numbers: readonly string[];
}

interface Nearest {
  readonly indexed: Indexed;
  readonly similarity: number;
}

function assertThresholds(duplicate: number, contradiction: number): void {
  for (const [name, value] of [
    ['duplicateSimilarity', duplicate],
    ['contradictionSimilarity', contradiction],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0 || value > 1) {
      throw new ExtractionError(
        'invalid_options',
        `${name} must be a number above 0 and at most 1; received ${String(value)}. Pass a threshold in that range, or omit it to use the default.`,
      );
    }
  }

  if (contradiction > duplicate) {
    throw new ExtractionError(
      'invalid_options',
      `contradictionSimilarity ${contradiction} is above duplicateSimilarity ${duplicate}, which would make every contradiction also a duplicate. Set contradictionSimilarity at or below duplicateSimilarity.`,
    );
  }
}

function index(existing: readonly ExistingItemSnapshot[]): readonly Indexed[] {
  return existing.map((item) => ({
    item,
    tokens: subjectTokens(item.title),
    stance: stanceOf(item.title),
    numbers: numericLiterals(item.title),
  }));
}

function nearestOfKind(
  indexed: readonly Indexed[],
  kind: ItemKind,
  tokens: ReadonlySet<string>,
): Nearest | null {
  let best: Nearest | null = null;

  for (const entry of indexed) {
    if (entry.item.kind !== kind) {
      continue;
    }
    const similarity = jaccard(tokens, entry.tokens);
    if (best === null || similarity > best.similarity) {
      best = { indexed: entry, similarity };
    }
  }

  return best;
}

function evidenceFor(
  nearest: Nearest,
  candidateStance: Stance,
  candidateNumbers: readonly string[],
  candidateTokens: ReadonlySet<string>,
  signal: ContradictionSignal | null,
): ReconcileEvidence {
  return {
    matchedItemId: nearest.indexed.item.id,
    matchedTitle: nearest.indexed.item.title,
    subjectSimilarity: Number(nearest.similarity.toFixed(4)),
    sharedSubjectTokens: sharedTokens(candidateTokens, nearest.indexed.tokens),
    candidateStance,
    existingStance: nearest.indexed.stance,
    candidateNumbers,
    existingNumbers: nearest.indexed.numbers,
    signal,
  };
}

function duplicateReason(evidence: ReconcileEvidence): string {
  return `Already recorded as context item ${evidence.matchedItemId} ("${evidence.matchedTitle}") at ${evidence.subjectSimilarity} subject overlap with the same stance and the same values, so re-recording it would cost a second review and settle nothing.`;
}

function contradictionReason(evidence: ReconcileEvidence): string {
  if (evidence.signal === 'value_conflict') {
    return `Contradicts context item ${evidence.matchedItemId} ("${evidence.matchedTitle}"): the same subject at ${evidence.subjectSimilarity} overlap, but the values differ — ${evidence.candidateNumbers.join(', ')} against ${evidence.existingNumbers.join(', ')}. A human decides which one holds.`;
  }
  return `Contradicts context item ${evidence.matchedItemId} ("${evidence.matchedTitle}"): the same subject at ${evidence.subjectSimilarity} overlap, but this candidate ${evidence.candidateStance === 'negate' ? 'denies' : 'asserts'} what the recorded item ${evidence.existingStance === 'negate' ? 'denies' : 'asserts'}. A human decides which one holds.`;
}

export const BODY_SAME_SIMILARITY = 0.9;

export function bodyMateriallyDiffers(
  candidateBody: string | null,
  existingBody: string | null | undefined,
): boolean {
  const candidateText = candidateBody ?? '';
  const existingText = existingBody ?? '';

  if (candidateText.trim() === existingText.trim()) {
    return false;
  }

  if (candidateText.trim() === '') {
    return false;
  }

  if (existingText.trim() === '') {
    return true;
  }

  return jaccard(subjectTokens(candidateText), subjectTokens(existingText)) < BODY_SAME_SIMILARITY;
}

const asNovel = (index: number, candidate: ExtractionCandidate): ReconciledCandidate => ({
  index,
  candidate,
  verdict: 'novel',
  evidence: null,
  reason: null,
});

interface Thresholds {
  readonly duplicateSimilarity: number;
  readonly contradictionSimilarity: number;
}

function judge(
  candidateIndex: number,
  candidate: ExtractionCandidate,
  indexed: readonly Indexed[],
  thresholds: Thresholds,
): ReconciledCandidate {
  const tokens = subjectTokens(candidate.title);
  const stance = stanceOf(candidate.title);
  const numbers = numericLiterals(candidate.title);
  const nearest = nearestOfKind(indexed, candidate.kind, tokens);

  if (nearest === null || nearest.similarity < thresholds.contradictionSimilarity) {
    return asNovel(candidateIndex, candidate);
  }

  const stanceFlipped = stance !== nearest.indexed.stance;
  const valuesDiffer = !sameNumbers(numbers, nearest.indexed.numbers);
  const valuesConflict = valuesDiffer && numbers.length > 0 && nearest.indexed.numbers.length > 0;
  const nearDuplicate = nearest.similarity >= thresholds.duplicateSimilarity;

  const signal: ContradictionSignal | null = stanceFlipped
    ? 'stance_flip'
    : nearDuplicate && valuesConflict
      ? 'value_conflict'
      : null;

  if (signal !== null) {
    const evidence = evidenceFor(nearest, stance, numbers, tokens, signal);
    return {
      index: candidateIndex,
      candidate,
      verdict: 'contradiction',
      evidence,
      reason: contradictionReason(evidence),
    };
  }

  if (bodyMateriallyDiffers(candidate.body, nearest.indexed.item.body)) {
    return asNovel(candidateIndex, candidate);
  }

  if (nearDuplicate && !valuesDiffer) {
    const evidence = evidenceFor(nearest, stance, numbers, tokens, null);
    return {
      index: candidateIndex,
      candidate,
      verdict: 'duplicate',
      evidence,
      reason: duplicateReason(evidence),
    };
  }

  return asNovel(candidateIndex, candidate);
}

export function reconcileCandidates(request: ReconcileRequest): ReconcileResult {
  const duplicateSimilarity = request.options?.duplicateSimilarity ?? DEFAULT_DUPLICATE_SIMILARITY;
  const contradictionSimilarity =
    request.options?.contradictionSimilarity ?? DEFAULT_CONTRADICTION_SIMILARITY;
  assertThresholds(duplicateSimilarity, contradictionSimilarity);

  const indexed = index(request.existing);
  const all = request.candidates.map((candidate, candidateIndex) =>
    judge(candidateIndex, candidate, indexed, { duplicateSimilarity, contradictionSimilarity }),
  );

  return {
    novel: all.filter((entry) => entry.verdict === 'novel'),
    duplicates: all.filter((entry) => entry.verdict === 'duplicate'),
    contradictions: all.filter((entry) => entry.verdict === 'contradiction'),
    all,
  };
}
