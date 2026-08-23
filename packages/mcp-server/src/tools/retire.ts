import type { RetireContextItemResult, ScopedStore } from '@mneia/core';
import { ApiError } from '@mneia/core';
import { z } from 'zod';
import { closedInputSchema } from './input-schema.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON_LENGTH = 1000;
const TOOL = 'mneia_retire';

const RetireInputSchema = z.object({
  projectId: z
    .string()
    .regex(UUID_PATTERN, { error: 'projectId must be a project id.' })
    .describe('Id of the project the item belongs to.'),
  itemId: z
    .string()
    .regex(UUID_PATTERN, { error: 'itemId must be a context item id.' })
    .describe('The item to retire. Take it from a rehydration slice, a handoff, or mneia_search.'),
  reason: z
    .string()
    .trim()
    .min(1, {
      error:
        'reason must say why this stopped being true — "the section heading was scraped as a rule, it was never a rule" is auditable; "wrong" is not.',
    })
    .max(MAX_REASON_LENGTH, {
      error: `reason must be at most ${MAX_REASON_LENGTH} characters.`,
    })
    .describe(
      'Why this item should no longer bind anyone. Recorded on the item and on the retiring checkpoint, so a reader months later can tell a correction from a mistake.',
    ),
});

export type RetireInput = z.infer<typeof RetireInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = closedInputSchema(
  z.toJSONSchema(RetireInputSchema, { target: 'draft-7', io: 'input' }),
);

interface RetireCapableStore extends ScopedStore {
  retireContextItem(input: {
    projectId: string;
    itemId: string;
    reason: string;
  }): Promise<RetireContextItemResult>;
}

const isRetireCapable = (store: ScopedStore): store is RetireCapableStore =>
  typeof (store as { retireContextItem?: unknown }).retireContextItem === 'function';

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseRetireInput(raw: unknown): RetireInput {
  const parsed = RetireInputSchema.safeParse(raw ?? {});
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

async function run(input: RetireInput, context: ToolContext): Promise<ToolResult> {
  if (!isRetireCapable(context.store)) {
    return failure(
      'unsupported',
      'This server is bound to a store that cannot retire items. Upgrade the client, or retire it from the project timeline in the web app.',
      { itemId: input.itemId },
    );
  }

  try {
    const result = await context.store.retireContextItem({
      projectId: input.projectId,
      itemId: input.itemId,
      reason: input.reason,
    });

    return {
      content: [
        {
          type: 'text',
          text: [
            `Retired [${result.item.kind}] "${result.item.title}".`,
            `item ${result.item.id} - checkpoint ${result.checkpoint.id}`,
            'It is out of every future slice and handoff. Nothing was deleted, and the timeline still shows it.',
          ].join('\n'),
        },
      ],
      structuredContent: {
        status: 'retired',
        itemId: result.item.id,
        checkpointId: result.checkpoint.id,
        kind: result.item.kind,
        title: result.item.title,
        reason: input.reason,
      },
    };
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (cause.code === 'not_found') {
        return failure('item_not_found', cause.message, { itemId: input.itemId });
      }
      if (cause.code === 'invalid_request') {
        return failure('not_retirable', cause.message, { itemId: input.itemId });
      }
    }
    return failure(
      'store_unavailable',
      `The item could not be retired: ${messageOf(cause)}. Nothing was written — the item still binds. Retry once; if it persists, report it rather than working around the item.`,
      { itemId: input.itemId },
    );
  }
}

export const retireTool: ToolDefinition<RetireInput> = {
  name: 'mneia_retire',
  title: 'Retire an item that should no longer bind anyone',
  description:
    'Take a stored item out of every future rehydration slice and handoff, because it was never right or is no longer true — a doc fragment captured as a rule, a constraint describing a bug that has since been fixed, a fact that has gone stale. This is a correction, not a deletion: the row stays, the timeline still shows it, and the reason is recorded on the retiring checkpoint. Use mneia_assert with supersedesId instead when a replacement item takes its place; retire is for when nothing replaces it. Only a human actor may retire, because retiring overrides what a human recorded.',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseRetireInput,
  run,
};
