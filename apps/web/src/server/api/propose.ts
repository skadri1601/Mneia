import 'server-only';

import type {
  CheckpointProposalWire,
  CheckpointProposeWire,
  ExtractionCandidate,
  ExtractionIncompleteReason,
  ScopedStore,
  TrajectoryTurn,
} from '@mneia/core';
import {
  applyPrecisionFilter,
  buildExtractionPrompt,
  chunkTurns,
  defaultTokenCounter,
  ExtractionError,
  parseExtractionOutput,
  reconcileCandidates,
  reduceTrajectory,
  renderTurn,
  resolveProject,
  turnsSince,
} from '@mneia/core';
import { costMicrosFor, estimateCostMicros } from '../billing/pricing.js';
import { ExtractionRunError } from '../extraction/select.js';
import { ApiRequestError } from './handlers.js';

const EXISTING_ITEM_LIMIT = 200;
const FOUND_SO_FAR_LIMIT = 40;
const MAX_OUTPUT_TOKENS = 8192;
const CONTEXT_SAFETY_MARGIN = 4096;
const MIN_CHUNK_TOKENS = 1024;

/**
 * Where gpt-5.6-luna's long-context pricing starts.
 *
 * At or below this, input bills at the standard rate. Above it the provider applies 2x
 * input and 1.5x output to the entire request, so splitting is strictly cheaper than
 * sending one call over the line.
 */
const LONG_CONTEXT_THRESHOLD_TOKENS = 272_000;

const promptOverheadTokens = (
  existingItems: readonly { readonly id: string; readonly title: string }[],
): number => {
  const empty = buildExtractionPrompt({ turns: [], existingItems });
  return defaultTokenCounter.count(empty.system) + defaultTokenCounter.count(empty.user);
};

export interface ExtractionAttemptRecord {
  readonly model: string;
  readonly outcome: 'succeeded' | 'failed' | 'fell_back';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export type QuotaVerdict =
  | { readonly allowed: true; readonly source: 'allowance' }
  | { readonly allowed: true; readonly source: 'wallet'; readonly debitMicros: number }
  | { readonly allowed: false; readonly code: string; readonly message: string };

export interface ProposeDependencies {
  /**
   * Decides whether this checkpoint may run, given what it is about to consume.
   *
   * Called once the prompt has been sized, so it is charged against real turn counts and
   * a real token estimate rather than the request's raw shape. Nothing external has
   * happened at that point - the work in between is local - so a refusal still costs
   * nothing.
   */
  readonly quota: (request: {
    turns: number;
    estimatedCostMicros: number;
  }) => Promise<QuotaVerdict>;
  // Structurally the same as ExtractionProviderRequest, declared inline so this module
  // does not depend on the runner. Keep the two in step: a field added there and missed
  // here is silently dropped rather than rejected.
  readonly run: (request: {
    system: string;
    user: string;
    maxOutputTokens: number;
    cacheKey?: string | undefined;
  }) => Promise<{ text: string; model: string; attempts: readonly ExtractionAttemptRecord[] }>;
  readonly watermarkFor: (input: {
    projectId: string;
    source: string;
    sessionRef: string;
  }) => Promise<string | null>;
  readonly recordUsage: (input: {
    projectId: string;
    attempts: readonly ExtractionAttemptRecord[];
    /** Turns actually consumed, which is what the turn dial meters. */
    turns: number;
    /** Real cost of the attempts above, priced from their reported token counts. */
    costMicros: number;
    /** Non-zero when this checkpoint ran on wallet balance rather than allowance. */
    walletDebitMicros: number;
  }) => Promise<void>;
  readonly servableContextTokens: number;
  /** Which model the estimate should be priced against, before any fallback happens. */
  readonly primaryModel: string;
}

const decodeTurns = (wire: CheckpointProposeWire): readonly TrajectoryTurn[] =>
  wire.turns.map((turn) => ({
    ref: turn.ref,
    role: turn.role,
    kind: turn.kind,
    text: turn.text,
    toolName: turn.toolName ?? null,
    at: turn.at === undefined || turn.at === null ? null : new Date(turn.at),
  }));

export const handleProposeCheckpoint = async (
  store: ScopedStore,
  input: CheckpointProposeWire,
  deps: ProposeDependencies,
): Promise<{ proposal: CheckpointProposalWire }> => {
  const project = await resolveProject(store, input.project);
  if (project === null) {
    throw new ApiRequestError(
      'not_found',
      `expected project "${input.project}" to name a project visible in this workspace; found none — check the slug with mneia status`,
    );
  }

  const watermark = await deps.watermarkFor({
    projectId: project.id,
    source: input.source,
    sessionRef: input.sessionRef,
  });

  const pending = turnsSince(decodeTurns(input), watermark);
  if (pending.turns.length === 0) {
    return {
      proposal: {
        workspaceId: store.scope.workspaceId,
        projectId: project.id,
        actorId: store.scope.actorId,
        candidates: [],
        rejectedCount: 0,
        watermark,
        consumedTurns: 0,
        model: '',
        pendingTurns: 0,
        incompleteReason: null,
      },
    };
  }

  // The watermark may only move to a position this request can prove is ahead of the
  // stored one, and the only proof available is finding the stored watermark inside the
  // upload: everything after it in the same array is later by construction. When the
  // upload does not reach back that far, extract it anyway - refusing would leave an
  // oversized or rotated session unable to checkpoint at all - but leave the watermark
  // where it is. The cost is re-reading those turns next time, which reconcileCandidates
  // already deduplicates; the alternative is a watermark that walks backwards and turns
  // that are never read at all.
  //
  // fromStart is the client declaring the transcript has rotated past the watermark, so
  // the stored one names a turn that no longer exists anywhere. Holding it there would
  // stall the session permanently, so that declaration is what unblocks the advance.
  const mayAdvanceWatermark = pending.resolved || input.fromStart === true;

  const reduced = reduceTrajectory(
    {
      source: input.source,
      sessionRef: input.sessionRef,
      cwd: null,
      turns: pending.turns,
    },
    { maxChars: Number.MAX_SAFE_INTEGER },
  );

  const existing = await store.listContextItems({
    projectId: project.id,
    statuses: ['active'],
    limit: EXISTING_ITEM_LIMIT,
  });

  const existingItems = existing.map((item) => ({ id: item.id, title: item.title }));
  const overhead = promptOverheadTokens(existingItems);

  // Cap the window we are willing to fill, independently of what the model can hold.
  // Past LONG_CONTEXT_THRESHOLD_TOKENS the provider charges 2x input and 1.5x output on
  // the *whole* request, not just the excess, so one oversized call costs more than the
  // two right-sized ones it replaces. This only binds when no fallback is configured:
  // with the Anthropic fallback present, servableContextTokens is already its 200K window.
  const servable = Math.min(deps.servableContextTokens, LONG_CONTEXT_THRESHOLD_TOKENS);
  const budget = servable - overhead - MAX_OUTPUT_TOKENS - CONTEXT_SAFETY_MARGIN;

  if (budget < MIN_CHUNK_TOKENS) {
    throw new ApiRequestError(
      'invalid_request',
      `the extraction prompt overhead leaves ${budget} tokens for the transcript, which is below the ${MIN_CHUNK_TOKENS} minimum — the project carries ${existingItems.length} active item titles against a ${servable} token window`,
    );
  }

  const { chunks, splitTurns } = chunkTurns(reduced.trajectory.turns, { budgetTokens: budget });

  // Charged here, not earlier: only now are the turn count and prompt size known, and the
  // allowance meters both. Everything between the early return above and this line is
  // local work, so a refusal still costs nothing but a database read.
  const estimatedInputTokens = chunks.reduce(
    (total, chunk) =>
      total + overhead + defaultTokenCounter.count(chunk.turns.map(renderTurn).join('\n')),
    0,
  );
  const verdict = await deps.quota({
    turns: reduced.trajectory.turns.length,
    estimatedCostMicros: estimateCostMicros(deps.primaryModel, estimatedInputTokens),
  });
  if (!verdict.allowed) {
    throw new ApiRequestError('forbidden', verdict.message);
  }

  const candidates: ExtractionCandidate[] = [];
  const attempts: ExtractionAttemptRecord[] = [];
  const sent = reduced.trajectory.turns;
  let completedThrough = -1;
  let model = '';
  let incompleteReason: string | null = null;
  let incompleteCode: ExtractionIncompleteReason | null = null;

  for (const [index, chunk] of chunks.entries()) {
    // Titles from earlier chunks of this same session, so a decision opened in one window
    // and settled in a later one is recognised as the same decision rather than missed by
    // both. Capped because this grows with every chunk and the transcript is what the
    // window is for.
    const foundSoFar = candidates.slice(-FOUND_SO_FAR_LIMIT).map((candidate) => candidate.title);
    const prompt = buildExtractionPrompt({
      turns: chunk.turns,
      existingItems,
      summary: input.summary ?? null,
      foundSoFar,
    });

    let run: Awaited<ReturnType<ProposeDependencies['run']>>;
    try {
      run = await deps.run({
        system: prompt.system,
        user: prompt.user,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        // Group cache lookups by project. The prefix - system prompt plus the
        // existing-items block - is identical for every checkpoint in a project and
        // changes only when its memory does, so this is the widest key that stays
        // correct. Keying per session would fragment it; keying per workspace would
        // collide across projects with different memory.
        cacheKey: `${store.scope.workspaceId}:${project.id}`,
      });
    } catch (error) {
      if (error instanceof ExtractionRunError) {
        attempts.push(...error.attempts);
      }
      incompleteCode = 'provider_failed';
      incompleteReason = `chunk ${index + 1} of ${chunks.length} did not complete, so the watermark stops before it and those turns are re-read on the next checkpoint: ${error instanceof Error ? error.message : String(error)}`;
      break;
    }

    attempts.push(...run.attempts);
    model = run.model;

    let output: ReturnType<typeof parseExtractionOutput>;
    try {
      output = parseExtractionOutput(run.text);
    } catch (error) {
      if (error instanceof ExtractionError) {
        incompleteCode = 'invalid_output';
        incompleteReason = `${run.model} returned an extraction this server could not validate for chunk ${index + 1} of ${chunks.length}, so nothing from it was kept and those turns are re-read: ${error.message}`;
        break;
      }
      throw error;
    }

    candidates.push(...output.candidates);
    completedThrough = chunk.completedThrough;
  }

  // Only when something actually ran. An empty attempt list means no provider call was
  // made, and metering a checkpoint that cost nothing is exactly the defect this work
  // exists to remove.
  if (attempts.length > 0) {
    await deps.recordUsage({
      projectId: project.id,
      attempts,
      turns: completedThrough + 1,
      costMicros: attempts.reduce(
        (total, attempt) =>
          total +
          costMicrosFor({
            model: attempt.model,
            inputTokens: attempt.inputTokens,
            outputTokens: attempt.outputTokens,
          }),
        0,
      ),
      walletDebitMicros: verdict.allowed && verdict.source === 'wallet' ? verdict.debitMicros : 0,
    });
  }

  const lastCommitted = completedThrough < 0 ? null : sent[completedThrough];
  if (lastCommitted === undefined || lastCommitted === null) {
    throw new ApiRequestError(
      'invalid_request',
      incompleteReason ??
        'the extraction completed no whole turn, so nothing was written and the trajectory is unconsumed',
    );
  }

  const consumedTurns = completedThrough + 1;
  const heldWatermark = mayAdvanceWatermark ? null : watermark;
  const pendingTurns = heldWatermark === null ? sent.length - consumedTurns : sent.length;
  const reason =
    heldWatermark === null
      ? incompleteReason
      : (incompleteReason ??
        `the upload does not contain watermark "${heldWatermark}", so the turns between it and the first turn sent are missing and nothing here proves this run got past it. The ${consumedTurns} turns sent were extracted and any new candidates are proposed, but the watermark stays put and they are read again next time. Send the turns from the watermark onward, or set fromStart when the transcript has rotated and no longer goes back that far.`);

  const filtered = applyPrecisionFilter(candidates);

  const reconciled = reconcileCandidates({
    candidates: filtered.kept,
    existing: existing.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
    })),
  });

  const carried = [...reconciled.novel, ...reconciled.contradictions].sort(
    (left, right) => left.index - right.index,
  );
  const byId = new Map(existing.map((item) => [item.id, item]));

  return {
    proposal: {
      workspaceId: store.scope.workspaceId,
      projectId: project.id,
      actorId: store.scope.actorId,
      candidates: carried.map((entry, index) => ({
        index,
        kind: entry.candidate.kind,
        title: entry.candidate.title,
        body: entry.candidate.body,
        rationale: entry.candidate.rationale,
        confidence: entry.candidate.confidence,
        loadBearing: entry.candidate.loadBearing,
        accessScope: entry.candidate.accessScope,
        sourceRef: entry.candidate.sourceRef,
        supersedesId: entry.evidence === null ? null : entry.evidence.matchedItemId,
        contradiction:
          entry.evidence === null || entry.evidence.signal === null
            ? null
            : {
                matchedItemId: entry.evidence.matchedItemId,
                matchedTitle: entry.evidence.matchedTitle,
                matchedHumanConfirmed:
                  byId.get(entry.evidence.matchedItemId)?.humanConfirmed ?? false,
                matchedLoadBearing: byId.get(entry.evidence.matchedItemId)?.loadBearing ?? false,
                subjectSimilarity: entry.evidence.subjectSimilarity,
                sharedSubjectTokens: [...entry.evidence.sharedSubjectTokens],
                signal: entry.evidence.signal,
                reason: entry.reason ?? '',
              },
      })),
      rejectedCount: filtered.rejected.length,
      duplicateCount: reconciled.duplicates.length,
      watermark: heldWatermark ?? lastCommitted.ref,
      consumedTurns,
      model,
      pendingTurns,
      incompleteReason: reason,
      coverage: {
        droppedTurns: reduced.droppedTurns,
        splitTurns,
        pendingTurns,
        consumedTurns,
        incompleteCode,
      },
    },
  };
};
