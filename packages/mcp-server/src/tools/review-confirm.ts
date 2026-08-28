import type {
  ContextItem,
  ContextItemReview,
  Project,
  ReviewPendingItemsInput,
  ReviewPendingItemsResult,
  ScopedStore,
  TelemetryEmitter,
  TelemetryEvent,
} from '@mneia/core';
import { ApiError, isStorableText, NULL_BYTE_ERROR } from '@mneia/core';
import { z } from 'zod';
import { closedInputSchema } from './input-schema.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const TOOL = 'mneia_review_confirm';

export const MAX_REASON_LENGTH = 1000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NO_NULL_BYTE = { error: NULL_BYTE_ERROR } as const;

/**
 * Said on every answer, including the successful ones.
 *
 * The tool relays a decision; it does not make one. An agent that reads its own approval back as
 * confirmation would be the §10.1 failure the whole review queue exists to prevent, so the reminder
 * travels with the result rather than living only in the description nobody re-reads.
 */
export const RELAY_NOTICE =
  'Only a person may confirm, edit, or reject an item (vision.md §10.1). This tool records a decision a human just gave you — it is not yours to make, and never call it from your own judgement about whether the item looks right. `mneia review --drain` remains the terminal route and is unchanged.';

export const NOT_A_HUMAN_ACTOR_REMEDY =
  'The store refuses a review from an agent actor, because human_confirmed is what decides who may overrule whom (vision.md §10.1). This server is authenticated as an agent, so it can read the queue with mneia_review_queue but cannot record a decision on it. Have the person drain it with `mneia review --drain`, or configure this server with the token of the human whose decision you are relaying.';

const ReviewConfirmInputSchema = z.object({
  project: z
    .string()
    .trim()
    .min(1, {
      error:
        'project must not be empty — pass the project slug, for example "payments-migration", or its id.',
    })
    .optional()
    .describe(
      'Project slug or project id the item belongs to. Omit only if the calling surface already has a project bound.',
    ),
  itemId: z
    .string()
    .regex(UUID_PATTERN, { error: 'itemId must be a context item id.' })
    .describe('The waiting item the person decided on. Take it from mneia_review_queue.'),
  decision: z
    .enum(['approve', 'reject'], {
      error: 'decision must be "approve" or "reject" — the two answers a person can give.',
    })
    .describe(
      'What the person said. approve marks the item human-confirmed; reject retires it, leaving the row and its history in place.',
    ),
  reason: z
    .string()
    .trim()
    .max(MAX_REASON_LENGTH, { error: `reason must be at most ${MAX_REASON_LENGTH} characters.` })
    .refine(isStorableText, NO_NULL_BYTE)
    .optional()
    .describe(
      'Why, in the person’s words. Required for reject, because a rejection with no reason is indistinguishable from a mistake months later. Optional for approve.',
    ),
});

export type ReviewConfirmInput = z.infer<typeof ReviewConfirmInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = closedInputSchema(
  z.toJSONSchema(ReviewConfirmInputSchema, { target: 'draft-7', io: 'input' }),
);

export interface ReviewConfirmCapableStore extends ScopedStore {
  reviewPendingItems(input: ReviewPendingItemsInput): Promise<ReviewPendingItemsResult>;
}

export const isReviewConfirmCapable = (store: ScopedStore): store is ReviewConfirmCapableStore =>
  typeof (store as { reviewPendingItems?: unknown }).reviewPendingItems === 'function';

export const REVIEW_CONFIRM_UNSUPPORTED_MESSAGE =
  'This server is bound to a store that cannot record a review decision. Upgrade @mneia/mcp-server so its @mneia/core ships reviewPendingItems, or have the person decide the item in the web app or with `mneia review --drain`.';

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseReviewConfirmInput(raw: unknown): ReviewConfirmInput {
  const parsed = ReviewConfirmInputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new Error(
      `${TOOL} rejected the input [invalid_input]. ${describeIssues(parsed.error)}. Correct the named fields and call the tool again.`,
    );
  }

  const { decision, reason } = parsed.data;
  if (decision === 'reject' && (reason === undefined || reason.length === 0)) {
    throw new Error(
      `${TOOL} rejected the input [invalid_input]. reason is required when decision is "reject" — record what the person said, in one line, so a reader months later can tell a correction from a mistake. Nothing was written.`,
    );
  }

  return parsed.data;
}

function failure(code: string, message: string, details: Record<string, unknown> = {}): ToolResult {
  return {
    content: [{ type: 'text', text: `${TOOL} failed [${code}]. ${message}` }],
    isError: true,
    structuredContent: { status: 'error', error: { code, message, ...details } },
  };
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * A lost §17 event must not lose the person's decision as well.
 *
 * The review is already committed by the time this runs, so a sink that is down would otherwise
 * turn a recorded confirmation into a tool call the agent reads as failed — and prompt it to ask
 * the person again. Same shape as assert.ts and checkpoint.ts.
 */
async function emitQuietly(telemetry: TelemetryEmitter, event: TelemetryEvent): Promise<void> {
  try {
    await telemetry.emit(event);
  } catch {
    return;
  }
}

async function resolveProject(context: ToolContext, project: string): Promise<Project | null> {
  if (UUID_PATTERN.test(project)) {
    return context.store.getProject(project);
  }
  return context.store.getProjectBySlug(project);
}

/**
 * The checkpoint summary the store records against this decision.
 *
 * `mneia review --drain` writes one through reviewSummary; keeping the same shape means a
 * timeline reader cannot tell a terminal reviewer from an MCP one without looking, which is
 * the point — the record is of the person's decision, not of the surface that carried it.
 */
export function relaySummary(input: ReviewConfirmInput, item: ContextItem): string {
  const head =
    input.decision === 'approve'
      ? 'Reviewed 1 item relayed through mneia_review_confirm: 1 confirmed, 0 rejected.'
      : 'Reviewed 1 item relayed through mneia_review_confirm: 0 confirmed, 1 rejected.';

  if (input.reason === undefined || input.reason.length === 0) {
    return head;
  }
  return input.decision === 'approve'
    ? `${head} Confirmed "${item.title}": ${input.reason}`
    : `${head} Rejected "${item.title}": ${input.reason}`;
}

const toReview = (input: ReviewConfirmInput): ContextItemReview =>
  input.decision === 'reject'
    ? { itemId: input.itemId, decision: 'reject' }
    : { itemId: input.itemId, decision: 'accept' };

async function run(input: ReviewConfirmInput, context: ToolContext): Promise<ToolResult> {
  const { store } = context;

  if (!isReviewConfirmCapable(store)) {
    return failure('unsupported', REVIEW_CONFIRM_UNSUPPORTED_MESSAGE, { itemId: input.itemId });
  }

  const requestedProject = input.project ?? context.defaultProject ?? undefined;
  if (requestedProject === undefined) {
    return failure(
      'project_not_bound',
      `No project was supplied and this server has no project bound. Call ${TOOL} again with "project" set to the project slug, for example {"project": "payments-migration"}, or run \`mneia init\` in the repository to bind one.`,
      { itemId: input.itemId },
    );
  }

  try {
    // Actor kind is read from the store, never from the payload — the caller does not get to
    // say whose decision this is. The store enforces the same rule inside its transaction; this
    // check exists only so the refusal names the cause instead of surfacing a store error.
    const actor = await store.getActor(store.scope.actorId);
    if (actor === null) {
      return failure(
        'actor_not_found',
        'The actor this connection is scoped to does not exist in the workspace. Re-authenticate the MCP server with a valid actor.',
        { actorId: store.scope.actorId, workspaceId: store.scope.workspaceId },
      );
    }
    if (actor.kind !== 'human') {
      return failure('not_a_human_actor', NOT_A_HUMAN_ACTOR_REMEDY, {
        actorId: actor.id,
        actorKind: actor.kind,
        itemId: input.itemId,
      });
    }

    const project = await resolveProject(context, requestedProject);
    if (project === null) {
      return failure(
        'project_not_found',
        `No project matching "${requestedProject}" is visible in this workspace. Check the slug against \`mneia status\`, or pass the project id instead of the slug.`,
        { project: requestedProject, workspaceId: store.scope.workspaceId },
      );
    }

    const item = await store.getContextItem(input.itemId);
    if (item === null) {
      return failure(
        'item_not_found',
        `No context item with that id is visible in this workspace. Call mneia_review_queue to re-read what is actually waiting, and pass an id it lists.`,
        { itemId: input.itemId },
      );
    }
    if (item.projectId !== project.id) {
      return failure(
        'project_mismatch',
        `That item belongs to a different project, so this decision would be recorded against the wrong one. Call ${TOOL} again with the project the item is in.`,
        { itemId: input.itemId, itemProjectId: item.projectId, projectId: project.id },
      );
    }
    if (item.humanConfirmed) {
      return failure(
        'already_confirmed',
        'A person already confirmed that item, and a review never overwrites a human-confirmed item (vision.md §10.1). Nothing was written. Re-read the queue with mneia_review_queue.',
        { itemId: input.itemId },
      );
    }
    if (item.status !== 'active') {
      return failure(
        'item_not_pending',
        `That item is "${item.status}", and only active items sit in the review queue, so there is nothing waiting to decide. Nothing was written. Re-read the queue with mneia_review_queue.`,
        { itemId: input.itemId, status: item.status },
      );
    }

    // The §17 emit below is not redundant with apps/web/src/server/api/review.ts. That wrapper
    // only runs when the decision arrives over REST — the stdio server's RemoteStore path, where
    // this tool's own emitter has no sink configured. The hosted /api/mcp endpoint hands the tool
    // a direct scoped Postgres store instead, so nothing else on that path would ever record the
    // arbitration event, and the arbitration dataset is not retrofittable.
    const result = await store.reviewPendingItems({
      projectId: project.id,
      reviews: [toReview(input)],
      summary: relaySummary(input, item),
    });

    const outcome = result.outcomes[0];
    if (outcome === undefined) {
      return failure(
        'review_incomplete',
        'The store accepted the review but returned no outcome, so nothing can be confirmed as recorded. Re-read the queue with mneia_review_queue before deciding it again.',
        { itemId: input.itemId, checkpointId: result.checkpoint.id },
      );
    }

    await emitQuietly(
      context.telemetry,
      outcome.outcome === 'rejected'
        ? {
            name: 'checkpoint.item_rejected',
            workspaceId: store.scope.workspaceId,
            projectId: project.id,
            actorId: actor.id,
            sessionId: context.sessionIdFor(project.id),
            occurredAt: context.now(),
            checkpointId: result.checkpoint.id,
            itemId: outcome.itemId,
          }
        : {
            name: 'checkpoint.item_confirmed',
            workspaceId: store.scope.workspaceId,
            projectId: project.id,
            actorId: actor.id,
            sessionId: context.sessionIdFor(project.id),
            occurredAt: context.now(),
            checkpointId: result.checkpoint.id,
            itemId: outcome.itemId,
          },
    );

    const headline =
      outcome.outcome === 'rejected'
        ? `Rejected [${item.kind}] "${item.title}" on the person's decision.`
        : `Confirmed [${item.kind}] "${item.title}" on the person's decision.`;

    const effect =
      outcome.outcome === 'rejected'
        ? 'It is out of every future slice and handoff. Nothing was deleted, and the timeline still shows it.'
        : 'It is human-confirmed now, so an agent assertion can no longer supersede it without a person.';

    return {
      content: [
        {
          type: 'text',
          text: [
            headline,
            `item ${item.id} - checkpoint ${result.checkpoint.id}`,
            effect,
            RELAY_NOTICE,
          ].join('\n'),
        },
      ],
      structuredContent: {
        status: 'recorded',
        projectId: project.id,
        itemId: item.id,
        checkpointId: result.checkpoint.id,
        decision: input.decision,
        outcome: outcome.outcome,
        reason: input.reason ?? null,
        kind: item.kind,
        title: item.title,
        loadBearing: item.loadBearing,
        humanConfirmed: outcome.outcome !== 'rejected',
        confirmedBy: { id: actor.id, kind: actor.kind },
        relayNotice: RELAY_NOTICE,
      },
    };
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (cause.code === 'not_found') {
        return failure('item_not_found', cause.message, { itemId: input.itemId });
      }
      if (cause.code === 'invalid_request') {
        return failure('not_reviewable', cause.message, { itemId: input.itemId });
      }
      if (cause.code === 'forbidden') {
        return failure('not_a_human_actor', `${cause.message} ${NOT_A_HUMAN_ACTOR_REMEDY}`, {
          itemId: input.itemId,
        });
      }
    }
    // Deliberately not "nothing was written". The API can commit the review and still lose the
    // response on the way back, so this branch cannot tell a refused write from a saved one —
    // and telling the person their decision was lost when it was recorded is the worse error.
    return failure(
      'store_unavailable',
      `Expected the store to say whether the decision was recorded; the call failed first: ${messageOf(cause)}. Whether it was written is unknown — the write can commit and the answer still be lost on the way back — so do not tell the person it was saved, and do not tell them it was lost. Call mneia_review_queue: if the item is still waiting, relay the decision again; if it is no longer listed, it was recorded.`,
      { itemId: input.itemId, written: 'unknown' },
    );
  }
}

export const reviewConfirmTool: ToolDefinition<ReviewConfirmInput> = {
  name: TOOL,
  title: 'Record a decision a person made on an item waiting for review',
  description:
    'Relay one human decision on one item from mneia_review_queue: approve marks it human-confirmed, reject retires it with the reason the person gave. Ask them through whatever your client uses to ask — an approval prompt, a question, a plain message — show them the item verbatim, and call this only after they answer. It is not a judgement you may make: the decision is what makes the arbitration record worth having (vision.md §10.1), and the store refuses this call outright unless the actor behind the token is a person. `mneia review --drain` is the terminal route to the same write and is unaffected. Use mneia_retire instead for an item nobody is waiting on.',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseReviewConfirmInput,
  run,
};
