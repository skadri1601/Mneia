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
import { estimateCostMicros } from '../billing/pricing.js';
import { ExtractionRunError } from '../extraction/select.js';
import { ApiRequestError } from './handlers.js';

const EXISTING_ITEM_LIMIT = 200;
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
  /**
   * Which processing tier the provider actually served this attempt on.
   *
   * Optional because the runner does not report it yet: `ExtractionAttempt` in
   * extraction/select.ts carries no tier, and the flex-to-standard retry happens inside
   * the provider where select.ts cannot see it. Until it does, this is stamped from the
   * configured tier below. Declared optional rather than required so select.ts can start
   * reporting the tier that really served — including that internal retry — and have it
   * win here with no further change.
   */
  readonly serviceTier?: 'auto' | 'flex' | undefined;
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
    /**
     * Every attempt, committed or not. This is our own cost accounting, and a provider
     * call we paid for and could not use is still a cost we need to see.
     */
    attempts: readonly ExtractionAttemptRecord[];
    /**
     * How many of `attempts`, counting from the front, belong to chunks that were
     * committed. Only these reach the customer's wallet.
     *
     * A chunked extraction that dies on chunk 3 has really produced chunks 1 and 2, and
     * the watermark stops there — so the customer is charged for two chunks and we absorb
     * the third. `attempts` is append-only in chunk order, which is what makes a prefix
     * count sufficient to express that.
     */
    chargeableAttempts: number;
    /** Turns actually consumed, which is what the turn dial meters. */
    turns: number;
    /**
     * What the pre-flight quota check authorized against prepaid balance, or 0 when this
     * checkpoint ran on allowance and no debit is owed.
     *
     * ## Authorization is not the charge
     *
     * This is the *estimate* — `estimateCostMicros` prices the prompt against
     * ASSUMED_OUTPUT_TOKENS, which pricing.ts sets deliberately high so a request is never
     * admitted that the balance cannot cover. Settling that figure would over-charge every
     * checkpoint whose completion came in under the assumption, which is nearly all of
     * them. So it travels as a ceiling only: the store prices the attempts that actually
     * ran and debits the smaller of the two. Under-charging is a margin miss; over-charging
     * is a refund and a support thread, so the reconciliation only ever moves downwards.
     *
     * One field rather than a flag plus an amount, so "funded by the wallet" and "nothing
     * was authorized" cannot disagree.
     */
    walletAuthorizationMicros: number;
  }) => Promise<void>;
  readonly servableContextTokens: number;
  /** Which model the estimate should be priced against, before any fallback happens. */
  readonly primaryModel: string;
  /**
   * The tier the runner is configured to request, used to price any attempt that does not
   * report its own. Standard bills at twice flex, so guessing it would put a 2x error
   * straight into both the ledger and the customer's debit.
   */
  readonly serviceTier: 'auto' | 'flex';
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

  // Placed after the zero-pending-turns return above, and that ordering is load-bearing.
  // The client's watermark probe uploads no turns, and turnsSince cannot find a watermark
  // in an empty array, so it reports resolved: false for every probe. Checking here would
  // refuse the probe and re-create MNE-100, where an oversized session could not be
  // checkpointed at all.
  if (!pending.resolved && input.fromStart !== true) {
    throw new ApiRequestError(
      'invalid_request',
      `the upload does not contain watermark "${watermark}", so the turns between it and the first turn sent are missing. Extracting anyway would move the watermark backwards and re-run extraction over turns already recorded, which is billed again. Send the turns from the watermark onward, or set fromStart when the transcript has rotated and no longer goes back that far.`,
    );
  }

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
  // Moves to attempts.length only when a chunk has been parsed and committed, so it marks
  // the boundary between work the customer received and work we absorbed.
  let chargeableAttempts = 0;
  let completedThrough = -1;
  let model = '';
  let incompleteReason: string | null = null;
  let incompleteCode: ExtractionIncompleteReason | null = null;

  for (const [index, chunk] of chunks.entries()) {
    const prompt = buildExtractionPrompt({ turns: chunk.turns, existingItems });

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
    chargeableAttempts = attempts.length;
  }

  // Only when something actually ran. An empty attempt list means no provider call was
  // made, and metering a checkpoint that cost nothing is exactly the defect this work
  // exists to remove.
  if (attempts.length > 0) {
    await deps.recordUsage({
      projectId: project.id,
      // Stamped with the configured tier where the attempt did not report one, so the
      // store never has to fall back to a rate and guess which one.
      attempts: attempts.map((attempt) => ({
        ...attempt,
        serviceTier: attempt.serviceTier ?? deps.serviceTier,
      })),
      chargeableAttempts,
      turns: completedThrough + 1,
      walletAuthorizationMicros: verdict.source === 'wallet' ? verdict.debitMicros : 0,
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
      watermark: lastCommitted.ref,
      consumedTurns,
      model,
      pendingTurns: sent.length - consumedTurns,
      incompleteReason,
      coverage: {
        droppedTurns: reduced.droppedTurns,
        splitTurns,
        pendingTurns: sent.length - consumedTurns,
        consumedTurns,
        incompleteCode,
      },
    },
  };
};
