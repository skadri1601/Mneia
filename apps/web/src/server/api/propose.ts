import 'server-only';

import type {
  CheckpointProposalWire,
  CheckpointProposeWire,
  ScopedStore,
  TrajectoryTurn,
} from '@mneia/core';
import {
  applyPrecisionFilter,
  buildExtractionPrompt,
  ExtractionError,
  parseExtractionOutput,
  reconcileCandidates,
  reduceTrajectory,
  resolveProject,
  turnsSince,
} from '@mneia/core';
import { ApiRequestError } from './handlers.js';

const EXISTING_ITEM_LIMIT = 200;
const MAX_OUTPUT_TOKENS = 8192;

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
      },
    };
  }

  const reduced = reduceTrajectory({
    source: input.source,
    sessionRef: input.sessionRef,
    cwd: null,
    turns: pending.turns,
  });

  const existing = await store.listContextItems({
    projectId: project.id,
    statuses: ['active'],
    limit: EXISTING_ITEM_LIMIT,
  });

  const prompt = buildExtractionPrompt({
    turns: reduced.trajectory.turns,
    existingItems: existing.map((item) => ({ id: item.id, title: item.title })),
  });

  const run = await deps.run({
    system: prompt.system,
    user: prompt.user,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });

  await deps.recordUsage({ projectId: project.id, attempts: run.attempts });

  let output: ReturnType<typeof parseExtractionOutput>;
  try {
    output = parseExtractionOutput(run.text);
  } catch (error) {
    if (error instanceof ExtractionError) {
      throw new ApiRequestError(
        'invalid_request',
        `${run.model} returned an extraction this server could not validate, so nothing was written: ${error.message}`,
      );
    }
    throw error;
  }

  const filtered = applyPrecisionFilter(output.candidates);
  const reconciled = reconcileCandidates({
    candidates: filtered.kept,
    existing: existing.map((item) => ({ id: item.id, kind: item.kind, title: item.title })),
  });
  const lastConsumed = pending.turns[pending.turns.length - 1];

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
                sharedSubjectTokens: entry.evidence.sharedSubjectTokens,
                signal: entry.evidence.signal,
                reason: entry.reason ?? '',
              },
      })),
      rejectedCount: filtered.rejected.length,
      duplicateCount: reconciled.duplicates.length,
      watermark: lastConsumed?.ref ?? watermark,
      consumedTurns: pending.turns.length,
      model: run.model,
    },
  };
};
