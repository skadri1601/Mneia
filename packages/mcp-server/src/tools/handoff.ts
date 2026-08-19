import type { Handoff, RemoteCreateHandoffRequest, ScopedStore } from '@mneia/core';
import { ApiError } from '@mneia/core';
import { z } from 'zod';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const MAX_NEXT_ACTION_LENGTH = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HandoffCapableStore extends ScopedStore {
  handoff(request: RemoteCreateHandoffRequest): Promise<Handoff>;
}

const isHandoffCapable = (store: ScopedStore): store is HandoffCapableStore =>
  typeof (store as { handoff?: unknown }).handoff === 'function';

const CreateInputSchema = z.object({
  nextAction: z
    .string()
    .trim()
    .min(1, {
      error:
        'nextAction must name one concrete thing to do next — "Wire the retry path in charges/worker.rb to the new idempotency key" transfers work; "continue the migration" does not.',
    })
    .max(MAX_NEXT_ACTION_LENGTH, {
      error: `nextAction must be at most ${MAX_NEXT_ACTION_LENGTH} characters — it is the one thing to do next, not the whole plan.`,
    })
    .describe(
      'The single concrete action the receiver should take first. This is the section that decides whether the handoff transferred anything.',
    ),
  project: z
    .string()
    .trim()
    .min(1, { error: 'project must not be empty — pass the project slug or its id.' })
    .optional()
    .describe(
      'Project slug or project id. Omit only if the calling surface already has a project bound.',
    ),
  toActor: z
    .string()
    .regex(UUID_PATTERN, { error: 'toActor must be an actor id.' })
    .optional()
    .describe(
      'Actor id to hand to. Omit for an open handoff that anyone in the workspace may pick up — that is the common case, including handing off to yourself tomorrow.',
    ),
  supersededWindowDays: z
    .number()
    .int({ error: 'supersededWindowDays must be a whole number of days.' })
    .min(1, { error: 'supersededWindowDays must be at least 1.' })
    .max(365, { error: 'supersededWindowDays must be at most 365.' })
    .optional()
    .describe(
      'How far back the "Superseded recently" block reaches. Defaults to 30 days. Widen it when the receiver has been away longer than that.',
    ),
});

const ReceiveInputSchema = z.object({
  id: z
    .string()
    .regex(UUID_PATTERN, { error: 'id must be a handoff id.' })
    .describe('The handoff to receive. Receiving marks it taken and records who took it.'),
});

export type CreateHandoffInput = z.infer<typeof CreateInputSchema>;
export type ReceiveHandoffInput = z.infer<typeof ReceiveInputSchema>;

const CREATE_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(CreateInputSchema, {
  target: 'draft-7',
  io: 'input',
});

const RECEIVE_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(ReceiveInputSchema, {
  target: 'draft-7',
  io: 'input',
});

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

const parseWith =
  <T>(schema: z.ZodType<T>, tool: string) =>
  (raw: unknown): T => {
    const parsed = schema.safeParse(raw ?? {});
    if (parsed.success) {
      return parsed.data;
    }
    throw new Error(
      `${tool} rejected the input [invalid_input]. ${describeIssues(parsed.error)}. Correct the named fields and call the tool again.`,
    );
  };

function failure(
  tool: string,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ToolResult {
  return {
    content: [{ type: 'text', text: `${tool} failed [${code}]. ${message}` }],
    isError: true,
    structuredContent: { status: 'error', error: { code, message, ...details } },
  };
}

const structured = (handoff: Handoff): Record<string, unknown> => ({
  status: 'ok',
  handoffId: handoff.id,
  projectId: handoff.projectId,
  fromActor: handoff.fromActor,
  toActor: handoff.toActor,
  createdAt: handoff.createdAt.toISOString(),
  receivedAt: handoff.receivedAt === null ? null : handoff.receivedAt.toISOString(),
  nextAction: handoff.nextAction,
});

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

async function runCreate(input: CreateHandoffInput, context: ToolContext): Promise<ToolResult> {
  const tool = 'mneia_handoff_create';
  const project = input.project ?? context.defaultProject ?? undefined;

  if (project === undefined) {
    return failure(
      tool,
      'project_not_bound',
      'No project was supplied and this server has no project bound. Call the tool again with "project" set to the project slug, or run `mneia init` in the repository to bind one.',
    );
  }

  if (!isHandoffCapable(context.store)) {
    return failure(
      tool,
      'unsupported',
      'This server is not connected to the hosted API, and a handoff is assembled server-side from project state. Check the endpoint in .mneia/config.json.',
    );
  }

  try {
    const created = await context.store.handoff({
      project,
      nextAction: input.nextAction,
      toActor: input.toActor ?? null,
      ...(input.supersededWindowDays === undefined
        ? {}
        : { supersededWindowDays: input.supersededWindowDays }),
    });

    const recipient =
      created.toActor === null ? 'open — anyone in the workspace may pick it up' : created.toActor;

    return {
      content: [
        {
          type: 'text',
          text: [
            created.rendered.trim(),
            '',
            '---',
            `handoff ${created.id} · to: ${recipient} · frozen ${created.createdAt.toISOString()}`,
            `The receiver calls mneia_handoff_receive with {"id": "${created.id}"}, or runs mneia pickup ${created.id}.`,
          ].join('\n'),
        },
      ],
      structuredContent: { ...structured(created), rendered: created.rendered },
    };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      return failure(tool, 'project_not_found', cause.message, { project });
    }
    return failure(
      tool,
      'store_unavailable',
      `The handoff could not be created: ${messageOf(cause)}. This is a transport or authentication failure, not a bad argument. Retry once; if it persists, report it rather than assuming the handoff exists.`,
      { project },
    );
  }
}

async function runReceive(input: ReceiveHandoffInput, context: ToolContext): Promise<ToolResult> {
  const tool = 'mneia_handoff_receive';

  try {
    const received = await context.store.receiveHandoff(input.id, context.store.scope.actorId);

    return {
      content: [
        {
          type: 'text',
          text: [
            received.rendered.trim(),
            '',
            '---',
            `received ${received.receivedAt === null ? 'now' : received.receivedAt.toISOString()} · handed over by ${received.fromActor}`,
            'This artifact is frozen at creation. Treat the Constraints section as binding and do not re-propose anything under Superseded recently.',
          ].join('\n'),
        },
      ],
      structuredContent: { ...structured(received), rendered: received.rendered },
    };
  } catch (cause) {
    if (cause instanceof ApiError) {
      if (cause.code === 'not_found') {
        return failure(tool, 'handoff_not_found', cause.message, { id: input.id });
      }
      if (cause.code === 'invalid_request') {
        return failure(tool, 'already_received', cause.message, { id: input.id });
      }
      if (cause.code === 'forbidden') {
        return failure(tool, 'wrong_receiver', cause.message, { id: input.id });
      }
    }
    return failure(
      tool,
      'store_unavailable',
      `The handoff could not be received: ${messageOf(cause)}. Retry once; if it persists, report it rather than starting work on an artifact you were not given.`,
      { id: input.id },
    );
  }
}

export const handoffCreateTool: ToolDefinition<CreateHandoffInput> = {
  name: 'mneia_handoff_create',
  title: 'Freeze a receivable handoff for whoever picks the work up next',
  description:
    'Produce the handoff artifact for this project: what to do next, the current state, the constraints that bind the receiver, the decisions and why, what is still open, what was already tried and rejected, and the artifacts. Call it when work changes hands — end of a session, end of a day, or handing to a teammate. The result is frozen markdown, so it is what the receiver reads no matter what happens to the project afterwards. Omit toActor for an open handoff, which is the common case and includes handing off to yourself tomorrow. This is not a summary of the conversation — use mneia_checkpoint for that; this assembles what the next person needs from what the project already knows.',
  inputSchema: CREATE_JSON_SCHEMA,
  parse: parseWith(CreateInputSchema, 'mneia_handoff_create'),
  run: runCreate,
};

export const handoffReceiveTool: ToolDefinition<ReceiveHandoffInput> = {
  name: 'mneia_handoff_receive',
  title: 'Receive a handoff and read what you were given',
  description:
    'Take a handoff, mark it received, and return the frozen artifact. Call it at the start of a session when you were handed work — the Constraints section is binding, and the Superseded recently block names approaches the team already rejected so you do not propose them again. Receiving records who took it; an open handoff becomes yours at that moment. Refuses a handoff already received by someone else, and one addressed to a different actor.',
  inputSchema: RECEIVE_JSON_SCHEMA,
  parse: parseWith(ReceiveInputSchema, 'mneia_handoff_receive'),
  run: runReceive,
};
