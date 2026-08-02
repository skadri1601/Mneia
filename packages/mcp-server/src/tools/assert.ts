import {
  ACCESS_SCOPES,
  ITEM_KINDS,
  type NewContextItem,
  type TelemetryEmitter,
  type TelemetryEvent,
  evaluateSupersede,
} from '@mneia/core';
import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const KIND_ERROR = `kind must be one of: ${ITEM_KINDS.join(', ')}`;
const SCOPE_ERROR = `accessScope must be one of: ${ACCESS_SCOPES.join(', ')}`;

const AssertInputSchema = z.object({
  projectId: z.uuid().describe('Id of the project this item belongs to.'),
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
  sessionId: z
    .uuid()
    .optional()
    .describe('Id of the session this assertion came from, when the caller is tracking one.'),
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
    .describe('How sure the caller is, 0 to 1. Defaults to 0.5.'),
  loadBearing: z
    .boolean()
    .default(false)
    .describe(
      'True when later work is wrong if this item is missing. Load-bearing constraints are never dropped from a rehydration slice.',
    ),
  accessScope: z
    .enum(ACCESS_SCOPES, { error: SCOPE_ERROR })
    .default('project')
    .describe('Who can see this item. Defaults to project.'),
  supersedesId: z
    .uuid()
    .optional()
    .describe(
      'Id of the existing item this assertion replaces. Supply it only when this genuinely contradicts that item; the arbitration rules decide whether the replacement is allowed, and an agent replacing a human-confirmed item is returned as pending instead of written.',
    ),
});

export type AssertInput = z.infer<typeof AssertInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = {
  ...z.toJSONSchema(AssertInputSchema, { target: 'draft-7', io: 'input' }),
  additionalProperties: false,
};

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseAssertInput(raw: unknown): AssertInput {
  const parsed = AssertInputSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    `mneia_assert rejected the input [invalid_input]. ${describeIssues(parsed.error)}. Correct the named fields and call the tool again.`,
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
    content: [{ type: 'text', text: `mneia_assert failed [${code}]. ${message}` }],
    isError: true,
    structuredContent: { status: 'error', error: { code, message, ...details } },
  };
}

async function run(input: AssertInput, context: ToolContext): Promise<ToolResult> {
  const { store, telemetry, now } = context;
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

    const supersedesId = input.supersedesId;
    if (supersedesId !== undefined) {
      const existing = await store.getContextItem(supersedesId);
      if (existing === null) {
        return failure(
          'unknown_supersedes_id',
          'No context item with that id is visible in this workspace. Run mneia_search to find the real id, or drop supersedesId to record this as a new item.',
          { supersedesId },
        );
      }
      if (existing.projectId !== input.projectId) {
        return failure(
          'project_mismatch',
          'The item named by supersedesId belongs to a different project. An item can only supersede one in its own project.',
          { supersedesId, itemProjectId: existing.projectId, projectId: input.projectId },
        );
      }

      const verdict = evaluateSupersede({
        existing,
        assertingActorKind: actor.kind,
        assertingActorId: actor.id,
        humanConfirmedByAsserter: actor.kind === 'human',
      });

      if (verdict.outcome !== 'allowed') {
        const blocked = {
          kind: input.kind,
          title: input.title,
          outcome: verdict.outcome,
          reason: verdict.reason,
          supersedesId,
          existingHumanConfirmed: existing.humanConfirmed,
          existingLoadBearing: existing.loadBearing,
        };
        return {
          content: [
            {
              type: 'text',
              text: [
                verdict.outcome === 'refused'
                  ? 'REFUSED - nothing was written.'
                  : 'PENDING HUMAN CONFIRMATION - nothing was written.',
                `[${input.kind}] "${input.title}" would replace item ${supersedesId}${existing.humanConfirmed ? ' (human-confirmed)' : ''}.`,
                `Reason: ${verdict.reason}`,
                'Next: surface this to a human and let them confirm or reject it. Do not retry the same call, and do not route around it by asserting without supersedesId.',
              ].join('\n'),
            },
          ],
          isError: verdict.outcome === 'refused',
          structuredContent: {
            status: verdict.outcome === 'refused' ? 'refused' : 'pending_human_confirmation',
            pendingCount: 1,
            pending: [blocked],
            written: null,
          },
        };
      }
    }

    const item: NewContextItem = {
      projectId: input.projectId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      assertedBy: actor.id,
      sourceSessionId: input.sessionId ?? null,
      sourceRef: input.sourceRef ?? null,
      confidence: input.confidence,
      humanConfirmed: actor.kind === 'human',
      loadBearing: input.loadBearing,
      accessScope: input.accessScope,
      supersedesId: supersedesId ?? null,
    };

    const write = await store.writeCheckpoint({
      checkpoint: {
        projectId: input.projectId,
        sessionId: input.sessionId ?? null,
        actorId: actor.id,
        trigger: 'manual',
        summary: null,
      },
      items: [{ action: supersedesId === undefined ? 'created' : 'superseded', item }],
    });

    const written = write.written[0];
    if (written === undefined) {
      return failure(
        'write_incomplete',
        'The store accepted the checkpoint but returned no written item. Nothing can be confirmed as stored; retry the assertion.',
        { checkpointId: write.checkpoint.id },
      );
    }

    await emitQuietly(telemetry, {
      name: 'checkpoint.item_extracted',
      workspaceId: store.scope.workspaceId,
      projectId: input.projectId,
      actorId: actor.id,
      sessionId: input.sessionId ?? null,
      occurredAt,
      checkpointId: write.checkpoint.id,
      itemId: written.id,
      kind: written.kind,
      confidence: written.confidence,
      loadBearing: written.loadBearing,
      trigger: 'manual',
    });

    if (supersedesId !== undefined) {
      await emitQuietly(telemetry, {
        name: 'item.superseded',
        workspaceId: store.scope.workspaceId,
        projectId: input.projectId,
        actorId: actor.id,
        sessionId: input.sessionId ?? null,
        occurredAt,
        previousItemId: supersedesId,
        nextItemId: written.id,
      });
    }

    return {
      content: [
        {
          type: 'text',
          text: [
            `Wrote [${written.kind}] "${written.title}".`,
            `item ${written.id} - checkpoint ${write.checkpoint.id}`,
            `${written.humanConfirmed ? 'human-confirmed' : 'unconfirmed'}${written.loadBearing ? ' - load-bearing' : ''}${supersedesId === undefined ? '' : ` - supersedes ${supersedesId}`}`,
          ].join('\n'),
        },
      ],
      structuredContent: {
        status: 'written',
        pendingCount: 0,
        pending: [],
        written: {
          itemId: written.id,
          checkpointId: write.checkpoint.id,
          kind: written.kind,
          title: written.title,
          status: written.status,
          humanConfirmed: written.humanConfirmed,
          loadBearing: written.loadBearing,
          supersededItemId: supersedesId ?? null,
        },
      },
    };
  } catch (cause) {
    return failure(
      'store_unavailable',
      `The assertion could not be recorded: ${messageOf(cause)}. Nothing was written. Retry, and if it persists report the failure rather than continuing without the item.`,
      { projectId: input.projectId },
    );
  }
}

export const assertTool: ToolDefinition<AssertInput> = {
  name: 'mneia_assert',
  title: 'Assert a decision, constraint, open question, or fact',
  description:
    'Record one durable item in project memory as soon as it is settled, without waiting for a checkpoint. Use it the moment a decision is made, a constraint is stated, or a question is left open, so the next session inherits it. Supply supersedesId when the item replaces an existing one; a replacement of a human-confirmed item is never written automatically and comes back as pending for a human to confirm. Use mneia_checkpoint instead when capturing a batch of items at a task or day boundary.',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseAssertInput,
  run,
};
