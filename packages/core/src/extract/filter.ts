import type { ExtractionCandidate } from './schema.js';
import { ExtractionError } from './schema.js';
import { jaccard, normalizeText, tokenize } from './similarity.js';

export const DEFAULT_CONFIDENCE_FLOOR = 0.35;
export const DEFAULT_MAX_CANDIDATES = 25;
export const MIN_TITLE_LENGTH = 12;
export const NEAR_DUPLICATE_SIMILARITY = 0.85;

export interface PrecisionFilterOptions {
  readonly confidenceFloor?: number | undefined;
  readonly maxCandidates?: number | undefined;
  readonly requireDecisionRationale?: boolean | undefined;
}

export interface RejectedCandidate {
  readonly candidate: ExtractionCandidate;
  readonly reason: string;
}

export interface PrecisionFilterResult {
  readonly kept: readonly ExtractionCandidate[];
  readonly rejected: readonly RejectedCandidate[];
}

const PLEASANTRY_PATTERNS: readonly RegExp[] = [
  /^(?:ok|okay|kk|sure|right|alright|all right|fine|cool|nice|great|perfect|awesome|excellent|lgtm|ship it|yep|yeah|yes|nope|no|hi|hello|hey|bye|goodbye)\b/,
  /^(?:thanks?|thank you|thx|ty|cheers|much appreciated|appreciate it)\b/,
  /^(?:you'?re welcome|no problem|np|my pleasure|any ?time|happy to help|glad (?:to help|i could help))\b/,
  /^(?:sounds good|got it|makes sense|understood|acknowledged|noted|will do|on it|good (?:morning|afternoon|evening|night))\b/,
  /^(?:continue|proceed|carry on|go ahead|keep going|next|let'?s (?:go|continue|proceed|start|begin))\b/,
  /^(?:the )?(?:user|human|assistant|agent|model) (?:said|says|greeted|thanked|acknowledged|agreed|confirmed|replied|responded|asked how|wants? to (?:continue|proceed))\b/,
  /^(?:discussion|conversation|chat|session|summary) (?:about|of|on)\b/,
];

interface Surviving {
  readonly candidate: ExtractionCandidate;
  readonly position: number;
  readonly tokens: ReadonlySet<string>;
}

function fillerReason(title: string, normalized: string): string | null {
  if (normalized === '') {
    return 'The title is empty once punctuation is removed, so it carries nothing a reader could act on.';
  }

  if (title.trim().length < MIN_TITLE_LENGTH) {
    return `The title is ${title.trim().length} characters, below the ${MIN_TITLE_LENGTH}-character floor — a title that short cannot state substance a reader will understand weeks later.`;
  }

  if (PLEASANTRY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return 'The title reads as conversational filler rather than a durable item; pleasantries, acknowledgements, and narration of the conversation are never worth keeping.';
  }

  return null;
}

function duplicateReason(
  tokens: ReadonlySet<string>,
  survivors: readonly Surviving[],
): string | null {
  for (const survivor of survivors) {
    const score = jaccard(tokens, survivor.tokens);
    if (score >= NEAR_DUPLICATE_SIMILARITY) {
      return `The title duplicates candidate ${survivor.position} ("${survivor.candidate.title}") at ${score.toFixed(2)} token overlap; the same item recorded twice costs two reviews and settles nothing.`;
    }
  }

  return null;
}

function confidenceReason(confidence: number, confidenceFloor: number): string | null {
  if (confidence >= confidenceFloor) {
    return null;
  }

  return `Confidence ${confidence} is below the ${confidenceFloor} floor, so the extraction is not sure enough that this was settled or is worth a human's attention.`;
}

function missingRationaleReason(candidate: ExtractionCandidate, required: boolean): string | null {
  if (!required || candidate.kind !== 'decision') {
    return null;
  }
  if ((candidate.rationale ?? '').trim().length > 0) {
    return null;
  }
  return 'A decision without its rationale does not stop anyone re-proposing the option that was rejected, so it is dropped rather than written.';
}

function assertOptions(confidenceFloor: number, maxCandidates: number): void {
  if (!Number.isFinite(confidenceFloor) || confidenceFloor < 0 || confidenceFloor > 1) {
    throw new ExtractionError(
      'invalid_options',
      `confidenceFloor must be a number between 0 and 1; received ${String(confidenceFloor)}. Pass a floor in that range, or omit it to use ${DEFAULT_CONFIDENCE_FLOOR}.`,
    );
  }

  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) {
    throw new ExtractionError(
      'invalid_options',
      `maxCandidates must be an integer of 1 or greater; received ${String(maxCandidates)}. Pass a positive cap, or omit it to use ${DEFAULT_MAX_CANDIDATES}.`,
    );
  }
}

function rankedOverflow(
  survivors: readonly Surviving[],
  maxCandidates: number,
): ReadonlySet<number> {
  if (survivors.length <= maxCandidates) {
    return new Set<number>();
  }

  const byConfidence = [...survivors].sort(
    (a, b) => b.candidate.confidence - a.candidate.confidence || a.position - b.position,
  );

  return new Set(byConfidence.slice(maxCandidates).map((survivor) => survivor.position));
}

export function applyPrecisionFilter(
  candidates: readonly ExtractionCandidate[],
  options: PrecisionFilterOptions = {},
): PrecisionFilterResult {
  const confidenceFloor = options.confidenceFloor ?? DEFAULT_CONFIDENCE_FLOOR;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const requireDecisionRationale = options.requireDecisionRationale ?? true;
  assertOptions(confidenceFloor, maxCandidates);

  const rejected: RejectedCandidate[] = [];
  const survivors: Surviving[] = [];

  for (const [position, candidate] of candidates.entries()) {
    const normalized = normalizeText(candidate.title);
    const tokens = tokenize(normalized);

    const reason =
      fillerReason(candidate.title, normalized) ??
      missingRationaleReason(candidate, requireDecisionRationale) ??
      confidenceReason(candidate.confidence, confidenceFloor) ??
      duplicateReason(tokens, survivors);

    if (reason !== null) {
      rejected.push({ candidate, reason });
      continue;
    }

    survivors.push({ candidate, position, tokens });
  }

  const overflow = rankedOverflow(survivors, maxCandidates);
  const kept: ExtractionCandidate[] = [];

  for (const survivor of survivors) {
    if (overflow.has(survivor.position)) {
      rejected.push({
        candidate: survivor.candidate,
        reason: `Only the ${maxCandidates} highest-confidence candidates are kept and this one ranked below them at confidence ${survivor.candidate.confidence}; a review queue longer than that trains the reader to stop reviewing.`,
      });
      continue;
    }
    kept.push(survivor.candidate);
  }

  return { kept, rejected };
}
