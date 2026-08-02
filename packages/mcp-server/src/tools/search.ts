import type { ContextItem, ContextItemSearch, Project } from '@mneia/core';
import { ITEM_KINDS, ITEM_STATUSES, truncateToTokens } from '@mneia/core';
import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const KIND_ERROR = `kinds must contain only: ${ITEM_KINDS.join(', ')}`;
const STATUS_ERROR = `statuses must contain only: ${ITEM_STATUSES.join(', ')}`;

export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 50;
export const BODY_PREVIEW_TOKENS = 40;

const MAX_TEXT_LENGTH = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SearchInputSchema = z.object({
  project: z
    .string()
    .trim()
    .min(1, {
      error:
        'project must not be empty — pass the project slug, for example "payments-migration", or its id.',
    })
    .optional()
    .describe(
      'Project slug or project id to search. Omit only if the calling surface already has a project bound.',
    ),
  text: z
    .string()
    .trim()
    .min(1, { error: 'text must not be empty — omit the argument instead of passing blanks.' })
    .max(MAX_TEXT_LENGTH, {
      error: `text must be at most ${MAX_TEXT_LENGTH} characters — search with the distinguishing phrase, not the whole passage.`,
    })
    .optional()
    .describe(
      'Free-text query matched against item titles and bodies. Omit to list everything matching the other filters.',
    ),
  kinds: z
    .array(z.enum(ITEM_KINDS, { error: KIND_ERROR }))
    .min(1, { error: 'kinds must name at least one kind, or be omitted entirely.' })
    .optional()
    .describe(
      'Restrict to these item kinds: decision, constraint, open_question, fact, artifact_ref. Omit to search every kind.',
    ),
  statuses: z
    .array(z.enum(ITEM_STATUSES, { error: STATUS_ERROR }))
    .min(1, { error: 'statuses must name at least one status, or be omitted entirely.' })
    .default(['active'])
    .describe(
      'Restrict to these statuses. Defaults to active only. Pass ["active","superseded"] to see what an item replaced, or ["disputed"] to find unresolved conflicts.',
    ),
  loadBearing: z
    .boolean()
    .optional()
    .describe(
      'True returns only load-bearing items — the ones later work is wrong without. Omit to ignore the flag.',
    ),
  limit: z
    .number()
    .int({ error: 'limit must be a whole number of items.' })
    .min(1, { error: 'limit must be at least 1.' })
    .max(MAX_SEARCH_LIMIT, {
      error: `limit must be at most ${MAX_SEARCH_LIMIT} — search returns specific items, not the whole project. Use mneia_rehydrate for a ranked slice.`,
    })
    .default(DEFAULT_SEARCH_LIMIT)
    .describe(
      `Maximum items to return. Defaults to ${DEFAULT_SEARCH_LIMIT}; results compete for the same context window as a rehydration slice.`,
    ),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(SearchInputSchema, {
  target: 'draft-7',
  io: 'input',
});

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseSearchInput(raw: unknown): SearchInput {
  const parsed = SearchInputSchema.safeParse(raw ?? {});
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `mneia_search rejected the input [invalid_input]. ${describeIssues(parsed.error)}. Correct the named fields and call the tool again.`,
  );
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failure(code: string, message: string, details: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: `mneia_search failed [${code}]. ${message}` }],
    isError: true,
    structuredContent: { status: 'error', error: { code, message, ...details } },
  };
}

async function resolveProject(context: ToolContext, project: string): Promise<Project | null> {
  if (UUID_PATTERN.test(project)) {
    return context.store.getProject(project);
  }
  return context.store.getProjectBySlug(project);
}

function searchFor(input: SearchInput, projectId: string, asOf: Date): ContextItemSearch {
  return {
    projectId,
    statuses: input.statuses,
    asOf,
    limit: input.limit,
    ...(input.text === undefined ? {} : { text: input.text }),
    ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
    ...(input.loadBearing === undefined ? {} : { loadBearing: input.loadBearing }),
  };
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const utcDay = (value: Date): string =>
  `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1, 2)}-${pad(value.getUTCDate(), 2)}`;

function markersFor(item: ContextItem): readonly string[] {
  const markers = [item.humanConfirmed ? 'human-confirmed' : 'unconfirmed'];

  if (item.loadBearing) {
    markers.push('load-bearing');
  }
  if (item.status !== 'active') {
    markers.push(item.status);
  }
  markers.push(utcDay(item.assertedAt));

  return markers;
}

function renderItem(item: ContextItem): string {
  const head = `- [${item.kind}] ${item.id} "${item.title}" — ${markersFor(item).join(' · ')}`;

  if (item.body === null || item.body.trim() === '') {
    return head;
  }

  const preview = truncateToTokens(item.body.replace(/\s+/g, ' ').trim(), BODY_PREVIEW_TOKENS);
  return preview === '' ? head : `${head}\n  ${preview}`;
}

function describeFilters(input: SearchInput): string {
  const parts = [`statuses ${input.statuses.join('/')}`];

  if (input.text !== undefined) {
    parts.push(`text "${input.text}"`);
  }
  if (input.kinds !== undefined) {
    parts.push(`kinds ${input.kinds.join('/')}`);
  }
  if (input.loadBearing !== undefined) {
    parts.push(`loadBearing ${String(input.loadBearing)}`);
  }

  return parts.join(', ');
}

function renderText(input: SearchInput, project: Project, items: readonly ContextItem[]): string {
  const filters = describeFilters(input);

  if (items.length === 0) {
    return [
      `mneia_search found no items in ${project.slug} matching ${filters}.`,
      'Widen the filters — drop text, add statuses, or clear kinds — before concluding nothing was recorded. Use mneia_rehydrate if you want the ranked slice for a task rather than a specific item.',
    ].join('\n\n');
  }

  const header =
    items.length === input.limit
      ? `mneia_search found ${items.length} items in ${project.slug} matching ${filters} — the limit was reached, so there may be more.`
      : `mneia_search found ${items.length === 1 ? '1 item' : `${items.length} items`} in ${project.slug} matching ${filters}.`;

  return [header, items.map(renderItem).join('\n')].join('\n\n');
}

async function run(input: SearchInput, context: ToolContext): Promise<ToolResult> {
  if (input.project === undefined) {
    return failure(
      'project_not_bound',
      'No project was supplied and this server has no project bound. Call mneia_search again with "project" set to the project slug, for example {"project": "payments-migration", "text": "idempotency key"}, or run `mneia init` in the repository to bind one.',
      {},
    );
  }

  try {
    const project = await resolveProject(context, input.project);
    if (project === null) {
      return failure(
        'project_not_found',
        `No project matching "${input.project}" is visible in this workspace. Check the slug against \`mneia status\`, or pass the project id instead of the slug.`,
        { project: input.project, workspaceId: context.store.scope.workspaceId },
      );
    }

    const items = await context.store.searchContextItems(
      searchFor(input, project.id, context.now()),
    );

    return {
      content: [{ type: 'text', text: renderText(input, project, items) }],
      structuredContent: {
        status: 'ok',
        projectId: project.id,
        matchCount: items.length,
        limit: input.limit,
        limitReached: items.length === input.limit,
        items: items.map((item) => ({
          itemId: item.id,
          kind: item.kind,
          title: item.title,
          status: item.status,
          humanConfirmed: item.humanConfirmed,
          loadBearing: item.loadBearing,
          confidence: item.confidence,
          assertedAt: item.assertedAt.toISOString(),
          sourceRef: item.sourceRef,
          supersededById: item.supersededById,
        })),
      },
    };
  } catch (cause) {
    return failure(
      'store_unavailable',
      `The search could not be run: ${messageOf(cause)}. This is a transport or authentication failure, not a bad argument. Retry once; if it persists, report it rather than assuming nothing was recorded.`,
      { project: input.project },
    );
  }
}

export const searchTool: ToolDefinition<SearchInput> = {
  name: 'mneia_search',
  title: 'Search project memory for specific items',
  description:
    'Look up specific items in project memory by kind, status, load-bearing flag, and free text. Use it when you already know what you are after — whether a constraint on this topic exists, what a decision said, or the id of the item you want to supersede. Returns a compact list with full item ids and provenance, not a ranked slice, and it competes for the same context window as one, so keep the limit small. Call mneia_rehydrate instead at the start of a task: that is the tool for "what do I need to know here?", while this one answers "where is this one thing?".',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseSearchInput,
  run,
};
