import type {
  Actor,
  ContextItem,
  ItemKind,
  NewContextItem,
  ScopedStore,
  SupersedeBlockedOutcome,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import { ACCESS_SCOPES, CHECKPOINT_TRIGGERS, evaluateSupersede, ITEM_KINDS } from '@mneia/core';
import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const KIND_ERROR = `kind must be one of: ${ITEM_KINDS.join(', ')}`;
const SCOPE_ERROR = `accessScope must be one of: ${ACCESS_SCOPES.join(', ')}`;
const TRIGGER_ERROR = `trigger must be one of: ${CHECKPOINT_TRIGGERS.join(', ')}`;

export const MAX_CANDIDATES = 50;

const CandidateSchema = z.object({
  kind: z
    .enum(ITEM_KINDS, { error: KIND_ERROR })
    .describe(
      'decision: a choice that was made. constraint: a rule later work must not violate. open_question: something unresolved and owned by nobody yet. fact: stable state worth carrying forward. artifact_ref: a pointer to a PR, doc, or ticket.',
    ),
  title: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      'The item in one line, written so it still reads correctly weeks later without the surrounding conversation.',
    ),
  body: z
    .string()
    .max(8000)
    .optional()
    .describe('Rationale and supporting detail. Omit when the title already says everything.'),
  sourceRef: z
    .string()
    .max(500)
    .optional()
    .describe('Where this came from: a PR url, file path, ticket key, or message id.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe('How sure the extraction is, 0 to 1. Defaults to 0.5.'),
  loadBearing: z
    .boolean()
    .default(false)
    .describe(
      'True when later work is wrong if this item is missing. A load-bearing candidate is never written by a checkpoint; it is returned in the pending queue for a human to confirm.',
    ),
  accessScope: z
    .enum(ACCESS_SCOPES, { error: SCOPE_ERROR })
    .default('project')
    .describe('Who can see this item. Defaults to project.'),
  supersedesId: z
    .uuid()
    .optional()
    .describe(
      'Id of the existing item this candidate contradicts and would replace. A contradicting candidate is never written by a checkpoint; it is returned in the pending queue with the arbitration verdict attached.',
    ),
});

const CheckpointInputSchema = z.object({
  projectId: z.uuid().describe('Id of the project this checkpoint belongs to.'),
  items: z
    .array(CandidateSchema)
    .min(1, { error: 'items must contain at least one extracted candidate.' })
    .max(MAX_CANDIDATES, {
      error: `items must contain at most ${MAX_CANDIDATES} candidates — split a longer session into several checkpoints.`,
    })
    .describe(
      'The candidate items you already extracted from the session. This tool does not read the transcript; it records what you hand it.',
    ),
  trigger: z
    .enum(CHECKPOINT_TRIGGERS, { error: TRIGGER_ERROR })
    .default('task_boundary')
    .describe(
      'Why this checkpoint is happening. task_boundary: a unit of work finished. day_boundary: a scheduled end of day. manual: a human asked for it. pre_compaction: the client is about to drop the transcript.',
    ),
  sessionId: z
    .uuid()
    .optional()
    .describe('Id of the session these candidates came from, when the caller is tracking one.'),
  summary: z
    .string()
    .max(2000)
    .optional()
    .describe('One paragraph describing what happened in the session this checkpoint closes.'),
});

export type CheckpointCandidate = z.infer<typeof CandidateSchema>;
export type CheckpointInput = z.infer<typeof CheckpointInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(CheckpointInputSchema, {
  target: 'draft-7',
  io: 'input',
});

const CONFIRM_NEXT_STEP =
  'Surface this to a human and let them confirm, edit, or reject it. It is not stored anywhere until they do.';

const REFUSED_NEXT_STEP =
  'A human confirmation will not fix this. Correct the call as the reason describes, then submit this candidate again.';

const PENDING_HEADING =
  'PENDING HUMAN CONFIRMATION — nothing was written for these, and they are lost unless a human resolves them:';

const PENDING_NEXT_STEP =
  'Next: surface every pending candidate to a human, verbatim, and let them confirm, edit, or reject it. Do not resubmit a pending candidate with loadBearing set to false or with supersedesId removed — that routes around the confirmation and destroys the record of the disagreement.';

interface PendingEntry {
  readonly index: number;
  readonly kind: ItemKind;
  readonly title: string;
  readonly outcome: SupersedeBlockedOutcome;
  readonly reason: string;
  readonly nextStep: string;
  readonly loadBearing: boolean;
  readonly supersedesId: Uuid | null;
  readonly existingHumanConfirmed: boolean | null;
  readonly existingLoadBearing: boolean | null;
}

interface WriteCandidate {
  readonly index: number;
  readonly item: NewContextItem;
}

interface WrittenItem {
  readonly index: number;
  readonly item: ContextItem;
}

interface Triaged {
  readonly writes: readonly WriteCandidate[];
  readonly pending: readonly PendingEntry[];
}

interface SupersedeTriage {
  readonly candidate: CheckpointCandidate;
  readonly supersedesId: Uuid;
  readonly index: number;
  readonly actor: Actor;
  readonly projectId: Uuid;
  readonly store: ScopedStore;
}

class CandidateInputError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'CandidateInputError';
    this.code = code;
    this.details = details;
  }
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseCheckpointInput(raw: unknown): CheckpointInput {
  const parsed = CheckpointInputSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `mneia_checkpoint rejected the input [invalid_input]. ${describeIssues(parsed.error)}. Correct the named fields and call the tool again.`,
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function emitQuietly(telemetry: TelemetryEmitter, event: TelemetryEvent): Promise<void> {
  try {
    await telemetry.emit(event);
  } catch {
    return;
  }
}

function failure(code: string, message: string, details: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: `mneia_checkpoint failed [${code}]. ${message}` }],
    isError: true,
    structuredContent: { status: 'error', error: { code, message, ...details } },
  };
}

function newItem(
  candidate: CheckpointCandidate,
  input: CheckpointInput,
  actor: Actor,
): NewContextItem {
  return {
    projectId: input.projectId,
    kind: candidate.kind,
    title: candidate.title,
    body: candidate.body ?? null,
    assertedBy: actor.id,
    sourceSessionId: input.sessionId ?? null,
    sourceRef: candidate.sourceRef ?? null,
    confidence: candidate.confidence,
    humanConfirmed: actor.kind === 'human',
    loadBearing: false,
    accessScope: candidate.accessScope,
    supersedesId: null,
  };
}

function pendingForLoadBearing(candidate: CheckpointCandidate, index: number): PendingEntry {
  return {
    index,
    kind: candidate.kind,
    title: candidate.title,
    outcome: 'requires_human_confirmation',
    reason:
      'This candidate is load_bearing, so later work is wrong if it is missing or wrong. vision.md §10.1 step 5 requires a human to confirm a load-bearing item before a checkpoint writes it.',
    nextStep: CONFIRM_NEXT_STEP,
    loadBearing: true,
    supersedesId: null,
    existingHumanConfirmed: null,
    existingLoadBearing: null,
  };
}

async function pendingForSupersede(triage: SupersedeTriage): Promise<PendingEntry> {
  const { candidate, supersedesId, index, actor, projectId, store } = triage;
  const existing = await store.getContextItem(supersedesId);

  if (existing === null) {
    throw new CandidateInputError(
      'unknown_supersedes_id',
      `items[${index}] names supersedesId ${supersedesId}, and no context item with that id is visible in this workspace. Nothing was written for any candidate in this call. Run mneia_search to find the real id, or drop supersedesId to record it as a new item, then submit the checkpoint again.`,
      { index, supersedesId },
    );
  }

  if (existing.projectId !== projectId) {
    throw new CandidateInputError(
      'project_mismatch',
      `items[${index}] names supersedesId ${supersedesId}, which belongs to a different project. An item can only supersede one in its own project. Nothing was written for any candidate in this call.`,
      { index, supersedesId, itemProjectId: existing.projectId, projectId },
    );
  }

  const verdict = evaluateSupersede({
    existing,
    assertingActorKind: actor.kind,
    assertingActorId: actor.id,
    humanConfirmedByAsserter: actor.kind === 'human',
  });

  const blocked = verdict.outcome !== 'allowed';

  return {
    index,
    kind: candidate.kind,
    title: candidate.title,
    outcome: blocked ? verdict.outcome : 'requires_human_confirmation',
    reason: blocked
      ? verdict.reason
      : `This candidate contradicts context_item ${existing.id} and would replace it. vision.md §10.1 step 5 requires a human to confirm a contradicting item before a checkpoint writes it; the arbitration rules allow the replacement once they do.`,
    nextStep: verdict.outcome === 'refused' ? REFUSED_NEXT_STEP : CONFIRM_NEXT_STEP,
    loadBearing: candidate.loadBearing,
    supersedesId,
    existingHumanConfirmed: existing.humanConfirmed,
    existingLoadBearing: existing.loadBearing,
  };
}

async function triage(input: CheckpointInput, actor: Actor, store: ScopedStore): Promise<Triaged> {
  const writes: WriteCandidate[] = [];
  const pending: PendingEntry[] = [];

  for (const [index, candidate] of input.items.entries()) {
    const supersedesId = candidate.supersedesId;

    if (supersedesId !== undefined) {
      pending.push(
        await pendingForSupersede({
          candidate,
          supersedesId,
          index,
          actor,
          projectId: input.projectId,
          store,
        }),
      );
      continue;
    }

    if (candidate.loadBearing) {
      pending.push(pendingForLoadBearing(candidate, index));
      continue;
    }

    writes.push({ index, item: newItem(candidate, input, actor) });
  }

  return { writes, pending };
}

async function emitForWritten(
  context: ToolContext,
  input: CheckpointInput,
  actor: Actor,
  checkpointId: Uuid,
  written: ContextItem,
  occurredAt: Date,
): Promise<void> {
  const base = {
    workspaceId: context.store.scope.workspaceId,
    projectId: input.projectId,
    actorId: actor.id,
    sessionId: input.sessionId ?? null,
    occurredAt,
  };

  await emitQuietly(context.telemetry, {
    ...base,
    name: 'checkpoint.item_extracted',
    checkpointId,
    itemId: written.id,
    kind: written.kind,
    confidence: written.confidence,
    loadBearing: written.loadBearing,
    trigger: input.trigger,
  });

  if (written.humanConfirmed) {
    await emitQuietly(context.telemetry, {
      ...base,
      name: 'checkpoint.item_confirmed',
      checkpointId,
      itemId: written.id,
    });
  }
}

function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`;
}

function renderPendingEntry(entry: PendingEntry): string {
  const markers = [
    entry.outcome === 'refused' ? 'REFUSED' : 'NEEDS A HUMAN',
    entry.loadBearing ? 'load-bearing' : null,
    entry.supersedesId === null
      ? null
      : `would replace item ${entry.supersedesId}${entry.existingHumanConfirmed === true ? ' (human-confirmed)' : ''}`,
  ].filter((part): part is string => part !== null);

  return [
    `  items[${entry.index}] [${entry.kind}] "${entry.title}" — ${markers.join(' · ')}`,
    `    Reason: ${entry.reason}`,
    `    Next: ${entry.nextStep}`,
  ].join('\n');
}

function renderWrittenItem(entry: WrittenItem): string {
  const { item } = entry;
  return `  items[${entry.index}] [${item.kind}] "${item.title}" — item ${item.id}${item.humanConfirmed ? ' · human-confirmed' : ''}`;
}

function renderText(
  pending: readonly PendingEntry[],
  written: readonly WrittenItem[],
  checkpointId: Uuid | null,
): string {
  const blocks: string[] = [
    pending.length === 0
      ? `mneia_checkpoint wrote ${plural(written.length, 'item')}; nothing is pending.`
      : `mneia_checkpoint wrote ${plural(written.length, 'item')} and is holding ${plural(pending.length, 'candidate')} PENDING HUMAN CONFIRMATION.`,
  ];

  if (pending.length > 0) {
    blocks.push([PENDING_HEADING, ...pending.map(renderPendingEntry)].join('\n'));
    blocks.push(PENDING_NEXT_STEP);
  }

  blocks.push(
    written.length === 0 || checkpointId === null
      ? 'Written: nothing. No checkpoint row was created, because every candidate needs a human first.'
      : [`Written to checkpoint ${checkpointId}:`, ...written.map(renderWrittenItem)].join('\n'),
  );

  return blocks.join('\n\n');
}

function statusFor(pendingCount: number, writtenCount: number): string {
  if (pendingCount === 0) {
    return 'written';
  }
  return writtenCount === 0 ? 'pending_human_confirmation' : 'partially_written';
}

function toolResult(
  input: CheckpointInput,
  pending: readonly PendingEntry[],
  written: readonly WrittenItem[],
  checkpointId: Uuid | null,
): ToolResult {
  return {
    content: [{ type: 'text', text: renderText(pending, written, checkpointId) }],
    structuredContent: {
      status: statusFor(pending.length, written.length),
      pendingCount: pending.length,
      pending: pending.map((entry) => ({ ...entry })),
      writtenCount: written.length,
      written: written.map((entry) => ({
        index: entry.index,
        itemId: entry.item.id,
        kind: entry.item.kind,
        title: entry.item.title,
        status: entry.item.status,
        humanConfirmed: entry.item.humanConfirmed,
        loadBearing: entry.item.loadBearing,
      })),
      checkpointId,
      projectId: input.projectId,
      trigger: input.trigger,
    },
  };
}

async function run(input: CheckpointInput, context: ToolContext): Promise<ToolResult> {
  const { store, now } = context;
  const occurredAt = now();

  try {
    const actor = await store.getActor(store.scope.actorId);
    if (actor === null) {
      return failure(
        'actor_not_found',
        'The actor this connection is scoped to does not exist in the workspace. Re-authenticate the MCP server with a valid actor.',
        { actorId: store.scope.actorId, workspaceId: store.scope.workspaceId },
      );
    }

    const { writes, pending } = await triage(input, actor, store);

    if (writes.length === 0) {
      return toolResult(input, pending, [], null);
    }

    const write = await store.writeCheckpoint({
      checkpoint: {
        projectId: input.projectId,
        sessionId: input.sessionId ?? null,
        actorId: actor.id,
        trigger: input.trigger,
        summary: input.summary ?? null,
      },
      items: writes.map((candidate) => ({ action: 'created' as const, item: candidate.item })),
    });

    if (write.written.length !== writes.length) {
      return failure(
        'write_incomplete',
        `The store accepted the checkpoint but returned ${write.written.length} written items for ${writes.length} candidates. Nothing can be confirmed as stored; retry the checkpoint.`,
        {
          checkpointId: write.checkpoint.id,
          expected: writes.length,
          received: write.written.length,
        },
      );
    }

    const written: readonly WrittenItem[] = write.written.map((item, position) => ({
      index: writes[position]?.index ?? position,
      item,
    }));

    for (const entry of written) {
      await emitForWritten(context, input, actor, write.checkpoint.id, entry.item, occurredAt);
    }

    return toolResult(input, pending, written, write.checkpoint.id);
  } catch (cause) {
    if (cause instanceof CandidateInputError) {
      return failure(cause.code, cause.message, cause.details);
    }
    return failure(
      'store_unavailable',
      `The checkpoint could not be recorded: ${messageOf(cause)}. Nothing was written. Retry, and if it persists report the failure rather than continuing without the items.`,
      { projectId: input.projectId },
    );
  }
}

export const checkpointTool: ToolDefinition<CheckpointInput> = {
  name: 'mneia_checkpoint',
  title: 'Checkpoint the session into project memory',
  description:
    'Record a batch of already-extracted items in project memory at a task or day boundary, as one atomic checkpoint. Hand it the candidate decisions, constraints, open questions, facts, and artifact refs you extracted from the session — this tool does not read the transcript itself. Candidates that are load-bearing or that supersede an existing item are never written automatically: they come back in a pending queue you must surface to a human verbatim, because auto-confirming them would erase the disagreement the human needs to settle. Use mneia_assert instead for a single item settled mid-session, and mneia_rehydrate at the start of the next session to read back what was written.',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseCheckpointInput,
  run,
};
