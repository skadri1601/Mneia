import {
  DEFAULT_KIND_QUOTAS,
  DEFAULT_SCORING_WEIGHTS,
  packSlice,
  renderSlice,
  scoreItems,
} from '@mneia/core';
import type {
  ContextItem,
  ItemKind,
  ItemStatus,
  Project,
  Slice,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

export const DEFAULT_TOKEN_BUDGET = 4000;
export const MIN_TOKEN_BUDGET = 500;
export const MAX_TOKEN_BUDGET = 32_000;

export const MANDATORY_ITEM_LIMIT = 1000;
export const RECENT_SUPERSEDED_LIMIT = 5;
export const MAX_CANDIDATES = 200;

const MAX_TASK_LENGTH = 4000;
const CANDIDATES_PER_1K_TOKENS = 40;
const MIN_CANDIDATES = 60;
const MAX_CAUSE_LENGTH = 200;
const ACTIVE_STATUSES: readonly ItemStatus[] = ['active'];
const SUPERSEDED_STATUSES: readonly ItemStatus[] = ['superseded'];
const MANDATORY_KINDS: readonly ItemKind[] = ['constraint'];
const SUPERSEDED_KINDS: readonly ItemKind[] = ['decision', 'constraint'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const rehydrateInputSchema = z.object({
  task: z
    .string({
      error: (issue) =>
        issue.input === undefined
          ? 'task is required — pass one or two sentences describing the work you are about to start.'
          : `task must be a string; received ${typeof issue.input}. Pass one or two sentences describing the work you are about to start.`,
    })
    .trim()
    .min(1, {
      error:
        'task must not be empty — describe the work, for example "wire the retry path in charges/worker.rb to the new idempotency key".',
    })
    .max(MAX_TASK_LENGTH, {
      error: `task must be at most ${MAX_TASK_LENGTH} characters — summarise the work instead of pasting the transcript.`,
    })
    .describe(
      'What you are about to work on, in one or two sentences. Used to rank which stored context matters for this task.',
    ),
  project: z
    .string({
      error: (issue) =>
        `project must be a string; received ${typeof issue.input}. Pass the project slug, for example "payments-migration".`,
    })
    .trim()
    .min(1, {
      error:
        'project must not be empty — pass the project slug, for example "payments-migration", or omit the argument entirely.',
    })
    .optional()
    .describe(
      'Project slug or project id to rehydrate. Omit only if the calling surface already has a project bound.',
    ),
  tokenBudget: z
    .number({
      error: (issue) =>
        `tokenBudget must be a number; received ${typeof issue.input}. Omit it to use the ${DEFAULT_TOKEN_BUDGET} token default.`,
    })
    .int({ error: 'tokenBudget must be a whole number of tokens.' })
    .min(MIN_TOKEN_BUDGET, {
      error: `tokenBudget must be at least ${MIN_TOKEN_BUDGET} — a smaller slice cannot carry the load-bearing constraints.`,
    })
    .max(MAX_TOKEN_BUDGET, {
      error: `tokenBudget must be at most ${MAX_TOKEN_BUDGET} — rehydrate returns a minimal slice, not the whole project.`,
    })
    .default(DEFAULT_TOKEN_BUDGET)
    .describe(
      `Approximate token budget for the returned slice. Defaults to ${DEFAULT_TOKEN_BUDGET}.`,
    ),
});

export type RehydrateInput = z.infer<typeof rehydrateInputSchema>;

class StoreUnavailableError extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`the Mneia store failed during ${operation}: ${describeCause(cause)}`, { cause });
    this.name = 'StoreUnavailableError';
    this.operation = operation;
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message.slice(0, MAX_CAUSE_LENGTH);
  }
  return 'no further detail was reported';
}

function describeIssues(error: z.ZodError<unknown>): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map((segment) => String(segment)).join('.');
      return path.length > 0 ? `${path} — ${issue.message}` : issue.message;
    })
    .join('; ');
}

export function parseRehydrateInput(raw: unknown): RehydrateInput {
  const result = rehydrateInputSchema.safeParse(raw ?? {});
  if (result.success) {
    return result.data;
  }
  throw new Error(
    `mneia_rehydrate received invalid input: ${describeIssues(result.error)} Correct the named arguments and call mneia_rehydrate again.`,
  );
}

function toolError(code: string, summary: string, remedy: string): ToolResult {
  return {
    content: [{ type: 'text', text: `${summary} ${remedy}` }],
    isError: true,
    structuredContent: { error: { code, summary, remedy } },
  };
}

function candidateLimitFor(tokenBudget: number): number {
  const scaled = Math.ceil((tokenBudget / 1000) * CANDIDATES_PER_1K_TOKENS);
  return Math.min(MAX_CANDIDATES, Math.max(MIN_CANDIDATES, scaled));
}

function mergeCandidates(...groups: readonly (readonly ContextItem[])[]): readonly ContextItem[] {
  const byId = new Map<Uuid, ContextItem>();
  for (const group of groups) {
    for (const item of group) {
      if (!byId.has(item.id)) {
        byId.set(item.id, item);
      }
    }
  }
  return [...byId.values()];
}

async function fromStore<T>(operation: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new StoreUnavailableError(operation, error);
  }
}

async function resolveProject(context: ToolContext, project: string): Promise<Project | null> {
  if (UUID_PATTERN.test(project)) {
    return fromStore('getProject', () => context.store.getProject(project));
  }
  return fromStore('getProjectBySlug', () => context.store.getProjectBySlug(project));
}

async function emitBestEffort(context: ToolContext, event: TelemetryEvent): Promise<void> {
  try {
    await context.telemetry.emit(event);
  } catch {
    return;
  }
}

async function runRehydrate(input: RehydrateInput, context: ToolContext): Promise<ToolResult> {
  const startedAt = performance.now();
  const now = context.now();

  if (input.project === undefined) {
    return toolError(
      'project_not_bound',
      'mneia_rehydrate has no project to read: none was supplied and this server has no project bound.',
      'Call mneia_rehydrate again with "project" set to the project slug, for example {"task": "...", "project": "payments-migration"}, or run `mneia init` in the repository to bind one.',
    );
  }

  try {
    const project = await resolveProject(context, input.project);
    if (project === null) {
      return toolError(
        'project_not_found',
        `mneia_rehydrate found no project matching "${input.project}" in this workspace.`,
        'Check the slug against `mneia status`, or call mneia_search to confirm the project exists before retrying.',
      );
    }

    const [candidates, mandatory, superseded] = await Promise.all([
      fromStore('searchContextItems', () =>
        context.store.searchContextItems({
          projectId: project.id,
          statuses: ACTIVE_STATUSES,
          asOf: now,
          limit: candidateLimitFor(input.tokenBudget),
        }),
      ),
      fromStore('listContextItems for load-bearing constraints', () =>
        context.store.listContextItems({
          projectId: project.id,
          kinds: MANDATORY_KINDS,
          statuses: ACTIVE_STATUSES,
          loadBearing: true,
          asOf: now,
          limit: MANDATORY_ITEM_LIMIT,
        }),
      ),
      fromStore('listContextItems for recently superseded items', () =>
        context.store.listContextItems({
          projectId: project.id,
          kinds: SUPERSEDED_KINDS,
          statuses: SUPERSEDED_STATUSES,
          limit: RECENT_SUPERSEDED_LIMIT,
        }),
      ),
    ]);

    const scored = scoreItems({
      items: mergeCandidates(mandatory, superseded, candidates),
      taskEmbedding: null,
      now,
      weights: DEFAULT_SCORING_WEIGHTS,
    });

    const packed = packSlice({
      scored,
      tokenBudget: input.tokenBudget,
      quotas: DEFAULT_KIND_QUOTAS,
    });

    const renderedMarkdown = renderSlice({
      task: input.task,
      packed,
      generatedAt: now,
    });

    const slice: Slice = {
      id: randomUUID(),
      projectId: project.id,
      task: input.task,
      items: packed.items,
      tokensUsed: packed.tokensUsed,
      tokenBudget: packed.tokenBudget,
      renderedMarkdown,
      generatedAt: now,
    };

    const itemIds = slice.items.map((scoredItem) => scoredItem.item.id);

    context.slices.record({ sliceId: slice.id, projectId: project.id, itemIds });

    await emitBestEffort(context, {
      name: 'rehydration.slice_shown',
      workspaceId: context.store.scope.workspaceId,
      projectId: project.id,
      actorId: context.store.scope.actorId,
      sessionId: context.sessionIdFor(project.id),
      occurredAt: now,
      sliceId: slice.id,
      itemIds,
      tokenBudget: slice.tokenBudget,
      tokensUsed: slice.tokensUsed,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return {
      content: [{ type: 'text', text: slice.renderedMarkdown }],
      structuredContent: {
        sliceId: slice.id,
        projectId: project.id,
        itemIds,
        mandatoryItemIds: packed.mandatoryItemIds,
        droppedItemIds: packed.droppedItemIds,
        tokenBudget: slice.tokenBudget,
        tokensUsed: slice.tokensUsed,
      },
    };
  } catch (error) {
    if (error instanceof StoreUnavailableError) {
      return toolError(
        'store_unavailable',
        `mneia_rehydrate could not reach the Mneia store — ${error.message}.`,
        'This is a transport or authentication failure, not a bad argument. Retry once; if it persists, check network reachability and that MNEIA_TOKEN is set and unexpired, then continue without the slice rather than guessing at prior decisions.',
      );
    }
    return toolError(
      'rehydrate_failed',
      `mneia_rehydrate failed while building the slice: ${describeCause(error)}.`,
      'Retry with a smaller tokenBudget; if it still fails, proceed without the slice and report the failure rather than assuming there is no prior context.',
    );
  }
}

export const rehydrateTool: ToolDefinition<RehydrateInput> = {
  name: 'mneia_rehydrate',
  title: 'Rehydrate project context',
  description:
    'Load the minimal high-signal context slice for the task you are about to start: the active constraints you must not violate, the decisions already made and why, the open questions, and what was recently superseded so you do not re-propose it. Call this once at the start of every session before planning or writing code, and again whenever the task changes — it is cheap and safe to call unconditionally. Returns rendered markdown plus the slice id and included item ids for correlation. Use mneia_search instead when you already know the specific thing you are looking for.',
  inputSchema: { ...z.toJSONSchema(rehydrateInputSchema, { io: 'input' }) },
  parse: parseRehydrateInput,
  run: runRehydrate,
};
