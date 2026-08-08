import 'server-only';

import type {
  CheckpointProposalWire,
  CheckpointProposeWire,
  ExtractionCandidate,
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
  reduceTrajectory,
  resolveProject,
  turnsSince,
} from '@mneia/core';
import { ApiRequestError } from './handlers.js';

const EXISTING_ITEM_LIMIT = 200;
const MAX_OUTPUT_TOKENS = 8192;
const CONTEXT_SAFETY_MARGIN = 4096;
const MIN_CHUNK_TOKENS = 1024;

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

export interface ProposeDependencies {
  readonly run: (request: {
    system: string;
    user: string;
    maxOutputTokens: number;
  }) => Promise<{ text: string; model: string; attempts: readonly ExtractionAttemptRecord[] }>;
  readonly watermarkFor: (input: {
    projectId: string;
    source: string;
    sessionRef: string;
  }) => Promise<string | null>;
  readonly recordUsage: (input: {
    projectId: string;
    attempts: readonly ExtractionAttemptRecord[];
  }) => Promise<void>;
  readonly servableContextTokens: number;
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
  const budget = deps.servableContextTokens - overhead - MAX_OUTPUT_TOKENS - CONTEXT_SAFETY_MARGIN;

  if (budget < MIN_CHUNK_TOKENS) {
    throw new ApiRequestError(
      'invalid_request',
      `the extraction prompt overhead leaves ${budget} tokens for the transcript, which is below the ${MIN_CHUNK_TOKENS} minimum — the project carries ${existingItems.length} active item titles against a ${deps.servableContextTokens} token window`,
    );
  }

  const { chunks } = chunkTurns(reduced.trajectory.turns, { budgetTokens: budget });

  const candidates: ExtractionCandidate[] = [];
  const attempts: ExtractionAttemptRecord[] = [];
  let lastCommitted: TrajectoryTurn | null = null;
  let consumedTurns = 0;
  let model = '';
  let incompleteReason: string | null = null;

  for (const [index, chunk] of chunks.entries()) {
    const prompt = buildExtractionPrompt({ turns: chunk.turns, existingItems });

    let run: Awaited<ReturnType<ProposeDependencies['run']>>;
    try {
      run = await deps.run({
        system: prompt.system,
        user: prompt.user,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
    } catch (error) {
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
        incompleteReason = `${run.model} returned an extraction this server could not validate for chunk ${index + 1} of ${chunks.length}, so nothing from it was kept and those turns are re-read: ${error.message}`;
        break;
      }
      throw error;
    }

    candidates.push(...output.candidates);
    lastCommitted = chunk.turns[chunk.turns.length - 1] ?? lastCommitted;
    consumedTurns += chunk.turns.length;
  }

  if (attempts.length > 0) {
    await deps.recordUsage({ projectId: project.id, attempts });
  }

  if (lastCommitted === null) {
    throw new ApiRequestError(
      'invalid_request',
      incompleteReason ??
        'the extraction produced no committed chunk, so nothing was written and the trajectory is unconsumed',
    );
  }

  const filtered = applyPrecisionFilter(candidates);

  return {
    proposal: {
      workspaceId: store.scope.workspaceId,
      projectId: project.id,
      actorId: store.scope.actorId,
      candidates: filtered.kept.map((candidate, index) => ({
        index,
        kind: candidate.kind,
        title: candidate.title,
        body: candidate.body,
        rationale: candidate.rationale,
        confidence: candidate.confidence,
        loadBearing: candidate.loadBearing,
        accessScope: candidate.accessScope,
        sourceRef: candidate.sourceRef,
      })),
      rejectedCount: filtered.rejected.length,
      watermark: lastCommitted.ref,
      consumedTurns,
      model,
      pendingTurns: pending.turns.length - consumedTurns,
      incompleteReason,
    },
  };
};
