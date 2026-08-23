import type {
  Actor,
  Handoff,
  Project,
  RemoteCreateHandoffRequest,
  ScopedStore,
  Uuid,
} from '@mneia/core';
import { ApiError, shortenItemIds } from '@mneia/core';
import { z } from 'zod';
import {
  ActorReferenceError,
  describeActorById,
  isRosterCapable,
  ROSTER_LIMIT,
  ROSTER_UNSUPPORTED_MESSAGE,
  resolveActorReference,
} from './actors.js';
import { closedInputSchema } from './input-schema.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const MAX_NEXT_ACTION_LENGTH = 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_INBOX_LIMIT = 50;
export const MAX_INBOX_LIMIT = 200;

interface HandoffCapableStore extends ScopedStore {
  handoff(request: RemoteCreateHandoffRequest): Promise<Handoff>;
}

const isHandoffCapable = (store: ScopedStore): store is HandoffCapableStore =>
  typeof (store as { handoff?: unknown }).handoff === 'function';

export interface InboxHandoffFilterInput {
  readonly projectId: Uuid;
  readonly limit?: number;
}

interface InboxCapableStore extends ScopedStore {
  listInboxHandoffs(filter: InboxHandoffFilterInput): Promise<readonly Handoff[]>;
}

const isInboxCapable = (store: ScopedStore): store is InboxCapableStore =>
  typeof (store as { listInboxHandoffs?: unknown }).listInboxHandoffs === 'function';

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
    .trim()
    .min(1, {
      error:
        'toActor must name somebody in this workspace — their name, their email, or their actor id. Omit it to leave the handoff open.',
    })
    .optional()
    .describe(
      'Who to hand to: the name, email, or actor id of somebody in this workspace, as mneia_team returns them. Omit for an open handoff that anyone in the workspace may pick up — that is the common case, including handing off to yourself tomorrow.',
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

const CREATE_JSON_SCHEMA: Record<string, unknown> = closedInputSchema(
  z.toJSONSchema(CreateInputSchema, { target: 'draft-7', io: 'input' }),
);

const RECEIVE_JSON_SCHEMA: Record<string, unknown> = closedInputSchema(
  z.toJSONSchema(ReceiveInputSchema, { target: 'draft-7', io: 'input' }),
);

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

async function rosterFor(context: ToolContext): Promise<readonly Actor[]> {
  if (!isRosterCapable(context.store)) {
    throw new Error(ROSTER_UNSUPPORTED_MESSAGE);
  }
  return context.store.listWorkspaceActors({ limit: ROSTER_LIMIT });
}

interface AddressedHandoff {
  readonly roster: readonly Actor[];
  readonly toActor: Uuid | null;
}

async function addressTo(
  reference: string | undefined,
  context: ToolContext,
): Promise<AddressedHandoff | { readonly refusal: ToolResult }> {
  const tool = 'mneia_handoff_create';

  if (reference === undefined) {
    return { roster: [], toActor: null };
  }

  let roster: readonly Actor[];
  try {
    roster = await rosterFor(context);
  } catch (cause) {
    if (UUID_PATTERN.test(reference)) {
      return { roster: [], toActor: reference };
    }
    return {
      refusal: failure(
        tool,
        'roster_unavailable',
        `"${reference}" has to be matched against the workspace roster, and the roster could not be read: ${messageOf(cause)}. Retry once, or pass the actor id directly so no lookup is needed.`,
        { toActor: reference },
      ),
    };
  }

  try {
    return { roster, toActor: resolveActorReference(reference, roster).id };
  } catch (cause) {
    if (cause instanceof ActorReferenceError) {
      return {
        refusal: failure(tool, cause.code, cause.message, {
          toActor: cause.reference,
          candidates: cause.candidates,
        }),
      };
    }
    throw cause;
  }
}

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

  const addressed = await addressTo(input.toActor, context);
  if ('refusal' in addressed) {
    return addressed.refusal;
  }
  const { roster, toActor } = addressed;

  try {
    const created = await context.store.handoff({
      project,
      nextAction: input.nextAction,
      toActor,
      ...(input.supersededWindowDays === undefined
        ? {}
        : { supersededWindowDays: input.supersededWindowDays }),
    });

    const recipient = describeActorById(roster, created.toActor);

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
    const roster = await rosterFor(context).catch((): readonly Actor[] => []);

    return {
      content: [
        {
          type: 'text',
          text: [
            received.rendered.trim(),
            '',
            '---',
            `received ${received.receivedAt === null ? 'now' : received.receivedAt.toISOString()} · handed over by ${describeActorById(roster, received.fromActor)}`,
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

const InboxInputSchema = z.object({
  project: z
    .string()
    .trim()
    .min(1, { error: 'project must not be empty — pass the project slug or its id.' })
    .optional()
    .describe(
      'Project slug or project id. Omit only if the calling surface already has a project bound.',
    ),
  limit: z
    .number()
    .int({ error: 'limit must be a whole number of handoffs.' })
    .min(1, { error: 'limit must be at least 1.' })
    .max(MAX_INBOX_LIMIT, { error: `limit must be at most ${MAX_INBOX_LIMIT}.` })
    .optional()
    .describe(
      `How many handoffs to return, most recently frozen first. Defaults to ${DEFAULT_INBOX_LIMIT}.`,
    ),
});

export type InboxHandoffInput = z.infer<typeof InboxInputSchema>;

const INBOX_JSON_SCHEMA: Record<string, unknown> = closedInputSchema(
  z.toJSONSchema(InboxInputSchema, { target: 'draft-7', io: 'input' }),
);

const utcMinute = (value: Date): string => value.toISOString().replace('T', ' ').slice(0, 16);

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

async function resolveHandoffProject(
  context: ToolContext,
  project: string,
): Promise<Project | null> {
  return UUID_PATTERN.test(project)
    ? context.store.getProject(project)
    : context.store.getProjectBySlug(project);
}

function inboxLine(
  handoff: Handoff,
  roster: readonly Actor[],
  shortIds: ReadonlyMap<Uuid, string>,
): string {
  return [
    `  [${shortIds.get(handoff.id) ?? handoff.id}]  ${utcMinute(handoff.createdAt)} UTC · from ${describeActorById(roster, handoff.fromActor)}`,
    `      to: ${describeActorById(roster, handoff.toActor)}`,
    `      ${handoff.nextAction}`,
  ].join('\n');
}

function renderInbox(
  addressed: readonly Handoff[],
  open: readonly Handoff[],
  roster: readonly Actor[],
  project: Project,
): string {
  const waiting = [...addressed, ...open];
  if (waiting.length === 0) {
    return `Nothing is waiting for you on ${project.slug}. Nobody has addressed a handoff to you, and no open handoff is unclaimed. Freeze one with mneia_handoff_create when work changes hands.`;
  }

  const shortIds = shortenItemIds(waiting.map((handoff) => handoff.id));
  const blocks: string[] = [
    `${countOf(waiting.length, 'handoff')} waiting on ${project.slug} — ${addressed.length} addressed to you, ${open.length} open to anyone.`,
  ];

  if (addressed.length > 0) {
    blocks.push(
      ['Addressed to you', addressed.map((h) => inboxLine(h, roster, shortIds)).join('\n')].join(
        '\n',
      ),
    );
  }
  if (open.length > 0) {
    blocks.push(
      [
        'Open — anyone may pick these up',
        open.map((h) => inboxLine(h, roster, shortIds)).join('\n'),
      ].join('\n'),
    );
  }

  const first = waiting[0];
  if (first !== undefined) {
    blocks.push(
      `Take one with mneia_handoff_receive {"id": "${first.id}"}. Receiving records who took it, and an open handoff becomes yours at that moment.`,
    );
  }

  return blocks.join('\n\n');
}

async function runInbox(input: InboxHandoffInput, context: ToolContext): Promise<ToolResult> {
  const tool = 'mneia_handoff_inbox';
  const requested = input.project ?? context.defaultProject ?? undefined;

  if (requested === undefined) {
    return failure(
      tool,
      'project_not_bound',
      'No project was supplied and this server has no project bound. Call the tool again with "project" set to the project slug, or run `mneia init` in the repository to bind one.',
    );
  }

  if (!isInboxCapable(context.store)) {
    return failure(
      tool,
      'unsupported',
      'This server is bound to a store that cannot list an inbox. Upgrade @mneia/mcp-server so its @mneia/core ships listInboxHandoffs, or read the handoffs from the web app.',
      { project: requested },
    );
  }

  const limit = input.limit ?? DEFAULT_INBOX_LIMIT;
  const viewerId = context.store.scope.actorId;

  try {
    const project = await resolveHandoffProject(context, requested);
    if (project === null) {
      return failure(
        tool,
        'project_not_found',
        `No project matching "${requested}" is visible in this workspace. Check the slug, or call mneia_search to confirm the project exists before retrying.`,
        { project: requested },
      );
    }

    const handoffs = await context.store.listInboxHandoffs({ projectId: project.id, limit });
    const roster = await rosterFor(context).catch((): readonly Actor[] => []);

    const addressed = handoffs.filter((handoff) => handoff.toActor === viewerId);
    const open = handoffs.filter((handoff) => handoff.toActor === null);
    const shortIds = shortenItemIds([...addressed, ...open].map((handoff) => handoff.id));

    const encode = (handoff: Handoff): Record<string, unknown> => ({
      id: handoff.id,
      shortId: shortIds.get(handoff.id) ?? handoff.id,
      projectId: handoff.projectId,
      fromActor: handoff.fromActor,
      fromActorLabel: describeActorById(roster, handoff.fromActor),
      toActor: handoff.toActor,
      toActorLabel: describeActorById(roster, handoff.toActor),
      addressedToYou: handoff.toActor === viewerId,
      createdAt: handoff.createdAt.toISOString(),
      receivedAt: handoff.receivedAt === null ? null : handoff.receivedAt.toISOString(),
      nextAction: handoff.nextAction,
    });

    return {
      content: [{ type: 'text', text: renderInbox(addressed, open, roster, project) }],
      structuredContent: {
        status: 'ok',
        projectId: project.id,
        projectSlug: project.slug,
        viewerId,
        limit,
        count: addressed.length + open.length,
        addressed: addressed.map(encode),
        open: open.map(encode),
      },
    };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      return failure(tool, 'project_not_found', cause.message, { project: requested });
    }
    return failure(
      tool,
      'store_unavailable',
      `The inbox could not be read: ${messageOf(cause)}. This is a transport or authentication failure, not a bad argument. Retry once; if it persists, report it rather than assuming nothing is waiting for you.`,
      { project: requested, limit },
    );
  }
}

export const handoffInboxTool: ToolDefinition<InboxHandoffInput> = {
  name: 'mneia_handoff_inbox',
  title: 'List the handoffs waiting for you on this project',
  description:
    'Return the unreceived handoffs on this project in two groups: the ones addressed to you, and the open ones anyone in the workspace may pick up. Each line names who froze it and the one concrete action they left. Call it at the start of a session before planning — a handoff you never opened is work somebody already did that you are about to redo. Take one with mneia_handoff_receive. Read-only: listing receives nothing and claims nothing.',
  inputSchema: INBOX_JSON_SCHEMA,
  parse: parseWith(InboxInputSchema, 'mneia_handoff_inbox'),
  run: runInbox,
};
