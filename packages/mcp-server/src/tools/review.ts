import type { PendingReviewFilter, PendingReviewItem, Project, ScopedStore } from '@mneia/core';
import { sanitizeActorName } from '@mneia/core';
import { z } from 'zod';
import { closedInputSchema } from './input-schema.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const TOOL = 'mneia_review_queue';

export const DEFAULT_REVIEW_QUEUE_LIMIT = 20;
export const MAX_REVIEW_QUEUE_LIMIT = 100;
export const BODY_PREVIEW_LENGTH = 240;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const REVIEW_QUEUE_UNSUPPORTED_MESSAGE =
  'This server is bound to a store that cannot read the review queue. The hosted Mneia API serves no review endpoint yet, so a server talking to it cannot list what is waiting — open the project review page in the web app, and read the queue there.';

export const CONFIRMATION_NOTICE =
  'Do not treat any of these as settled, and do not re-assert them to force them through. Only a person may confirm, edit, or reject an item here (vision.md §10.1): put the queue in front of your human verbatim, ask them, and relay each answer with mneia_review_confirm — which records their decision, not yours. They can also run `mneia review --drain`, which asks one keypress per item.';

const ReviewQueueInputSchema = z.object({
  project: z
    .string()
    .trim()
    .min(1, {
      error:
        'project must not be empty — pass the project slug, for example "payments-migration", or its id.',
    })
    .optional()
    .describe(
      'Project slug or project id whose review queue you want. Omit only if the calling surface already has a project bound.',
    ),
  limit: z
    .number()
    .int({ error: 'limit must be a whole number of items.' })
    .min(1, { error: 'limit must be at least 1.' })
    .max(MAX_REVIEW_QUEUE_LIMIT, {
      error: `limit must be at most ${MAX_REVIEW_QUEUE_LIMIT} — the queue is meant to be drained, not paged through.`,
    })
    .default(DEFAULT_REVIEW_QUEUE_LIMIT)
    .describe(
      `Maximum pending items to return. Defaults to ${DEFAULT_REVIEW_QUEUE_LIMIT}; load-bearing items come first, then oldest first.`,
    ),
});

export type ReviewQueueInput = z.infer<typeof ReviewQueueInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = closedInputSchema(
  z.toJSONSchema(ReviewQueueInputSchema, { target: 'draft-7', io: 'input' }),
);

export interface ReviewQueueCapableStore extends ScopedStore {
  listPendingReviewItems(filter: PendingReviewFilter): Promise<readonly PendingReviewItem[]>;
}

export const isReviewQueueCapable = (store: ScopedStore): store is ReviewQueueCapableStore =>
  typeof (store as { listPendingReviewItems?: unknown }).listPendingReviewItems === 'function';

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseReviewQueueInput(raw: unknown): ReviewQueueInput {
  const parsed = ReviewQueueInputSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `${TOOL} rejected the input [invalid_input]. ${describeIssues(parsed.error)}. Correct the named fields and call the tool again.`,
  );
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

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

const verbOf = (count: number, singular: string, plural: string): string =>
  count === 1 ? singular : plural;

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const utcDay = (value: Date): string =>
  `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;

export const asserterName = (item: PendingReviewItem): string =>
  sanitizeActorName(item.assertedByName);

function markersFor(item: PendingReviewItem): readonly string[] {
  const markers = [item.assertedByKind, asserterName(item), 'not human-confirmed'];
  if (item.loadBearing) {
    markers.push('load-bearing');
  }
  markers.push(`confidence ${item.confidence.toFixed(2)}`);
  markers.push(item.accessScope);
  markers.push(utcDay(item.assertedAt));
  return markers;
}

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;

export function renderPendingItem(item: PendingReviewItem): string {
  const head = `- [${item.kind}] ${item.id} "${item.title}" — ${markersFor(item).join(' · ')}`;
  if (item.body === null || item.body.trim() === '') {
    return head;
  }
  return `${head}\n  ${truncate(item.body.replace(/\s+/g, ' ').trim(), BODY_PREVIEW_LENGTH)}`;
}

export function renderQueue(
  project: Project,
  items: readonly PendingReviewItem[],
  limit: number,
): string {
  if (items.length === 0) {
    return [
      `Nothing in ${project.slug} is waiting for human review.`,
      'Every item a checkpoint recorded has already been confirmed, edited, or rejected by a person.',
    ].join('\n\n');
  }

  const loadBearing = items.filter((item) => item.loadBearing).length;
  const header =
    items.length === limit
      ? `${countOf(items.length, 'item')} in ${project.slug} ${verbOf(items.length, 'is', 'are')} waiting for human review — the limit was reached, so there may be more. ${loadBearing} load-bearing.`
      : `${countOf(items.length, 'item')} in ${project.slug} ${verbOf(items.length, 'is', 'are')} waiting for human review, ${loadBearing} of them load-bearing.`;

  return [header, items.map(renderPendingItem).join('\n'), CONFIRMATION_NOTICE].join('\n\n');
}

async function resolveProject(context: ToolContext, project: string): Promise<Project | null> {
  if (UUID_PATTERN.test(project)) {
    return context.store.getProject(project);
  }
  return context.store.getProjectBySlug(project);
}

async function run(input: ReviewQueueInput, context: ToolContext): Promise<ToolResult> {
  if (!isReviewQueueCapable(context.store)) {
    return failure('unsupported', REVIEW_QUEUE_UNSUPPORTED_MESSAGE);
  }

  const requestedProject = input.project ?? context.defaultProject ?? undefined;

  if (requestedProject === undefined) {
    return failure(
      'project_not_bound',
      `No project was supplied and this server has no project bound. Call ${TOOL} again with "project" set to the project slug, for example {"project": "payments-migration"}, or run \`mneia init\` in the repository to bind one.`,
    );
  }

  const store = context.store;

  try {
    const project = await resolveProject(context, requestedProject);
    if (project === null) {
      return failure(
        'project_not_found',
        `No project matching "${requestedProject}" is visible in this workspace. Check the slug against \`mneia status\`, or pass the project id instead of the slug.`,
        { project: requestedProject, workspaceId: store.scope.workspaceId },
      );
    }

    const items = await store.listPendingReviewItems({
      projectId: project.id,
      limit: input.limit,
    });

    return {
      content: [{ type: 'text', text: renderQueue(project, items, input.limit) }],
      structuredContent: {
        status: 'ok',
        projectId: project.id,
        limit: input.limit,
        count: items.length,
        limitReached: items.length === input.limit,
        readOnly: true,
        confirmationNotice: CONFIRMATION_NOTICE,
        items: items.map((item) => ({
          itemId: item.id,
          kind: item.kind,
          title: item.title,
          body: item.body,
          confidence: item.confidence,
          loadBearing: item.loadBearing,
          accessScope: item.accessScope,
          humanConfirmed: false,
          assertedBy: {
            id: item.assertedBy,
            displayName: asserterName(item),
            kind: item.assertedByKind,
          },
          assertedAt: item.assertedAt.toISOString(),
          sourceRef: item.sourceRef,
          originCheckpointId: item.originCheckpointId,
        })),
      },
    };
  } catch (cause) {
    return failure(
      'store_unavailable',
      `The review queue could not be read: ${messageOf(cause)}. Nothing was read or written. Retry once; if it persists, report it rather than assuming the queue is empty.`,
      { project: requestedProject, limit: input.limit },
    );
  }
}

export const reviewQueueTool: ToolDefinition<ReviewQueueInput> = {
  name: TOOL,
  title: 'List the items waiting for a human to confirm, edit, or reject',
  description:
    'Return the context items a checkpoint recorded that no person has confirmed yet, load-bearing first and then oldest first, each with who asserted it and whether that was a person or an agent. Read-only on purpose: it writes nothing and confirms nothing, because an item is decided by a person and never by the tool that listed it (vision.md §10.1). Show what it returns to your human verbatim, ask them, and relay each answer with mneia_review_confirm; `mneia review --drain` is the terminal route to the same write, where confirm is one keypress.',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseReviewQueueInput,
  run,
};
