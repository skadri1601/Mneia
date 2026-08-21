import type { Actor } from '@mneia/core';
import { z } from 'zod';
import {
  describeActor,
  isRosterCapable,
  orderRoster,
  ROSTER_LIMIT,
  ROSTER_UNSUPPORTED_MESSAGE,
  shortActorId,
  shortActorIds,
} from './actors.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const TOOL = 'mneia_team';

const TeamInputSchema = z.object({
  limit: z
    .number()
    .int({ error: 'limit must be a whole number of actors.' })
    .min(1, { error: 'limit must be at least 1.' })
    .max(ROSTER_LIMIT, { error: `limit must be at most ${ROSTER_LIMIT}.` })
    .optional()
    .describe(
      `How many actors to return. Defaults to ${ROSTER_LIMIT}, which is the whole roster for every workspace this product supports today.`,
    ),
});

export type TeamInput = z.infer<typeof TeamInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(TeamInputSchema, {
  target: 'draft-7',
  io: 'input',
});

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseTeamInput(raw: unknown): TeamInput {
  const parsed = TeamInputSchema.safeParse(raw ?? {});
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

function renderRoster(actors: readonly Actor[], viewerId: string): string {
  if (actors.length === 0) {
    return 'No actors are visible in this workspace. That should not happen while this server is authenticated — report it if your own actor is missing.';
  }

  const ordered = orderRoster(actors);
  const shortIds = shortActorIds(actors);
  const humans = actors.filter((actor) => actor.kind === 'human').length;

  const lines = ordered.map((actor) => {
    const you = actor.id === viewerId ? ' · you' : '';
    return `  ${describeActor(actor, shortIds)}${you}`;
  });

  const example = ordered.find((actor) => actor.id !== viewerId) ?? ordered[0];
  const footer =
    example === undefined
      ? 'Address a handoff by passing toActor to mneia_handoff_create.'
      : `Address a handoff with mneia_handoff_create {"nextAction": "...", "toActor": "${shortActorId(example, shortIds)}"} — toActor also takes a name or an email.`;

  return [
    `${countOf(actors.length, 'actor')} in this workspace, humans first — ${countOf(humans, 'human')}, ${countOf(actors.length - humans, 'agent')}.`,
    '',
    lines.join('\n'),
    '',
    footer,
  ].join('\n');
}

async function run(input: TeamInput, context: ToolContext): Promise<ToolResult> {
  if (!isRosterCapable(context.store)) {
    return failure('unsupported', ROSTER_UNSUPPORTED_MESSAGE);
  }

  const limit = input.limit ?? ROSTER_LIMIT;
  const viewerId = context.store.scope.actorId;

  try {
    const actors = await context.store.listWorkspaceActors({ limit });
    const ordered = orderRoster(actors);
    const shortIds = shortActorIds(actors);

    return {
      content: [{ type: 'text', text: renderRoster(actors, viewerId) }],
      structuredContent: {
        status: 'ok',
        workspaceId: context.store.scope.workspaceId,
        viewerId,
        limit,
        count: actors.length,
        actors: ordered.map((actor) => ({
          id: actor.id,
          shortId: shortActorId(actor, shortIds),
          displayName: actor.displayName,
          kind: actor.kind,
          human: actor.kind === 'human',
          externalRef: actor.externalRef,
          you: actor.id === viewerId,
          createdAt: actor.createdAt.toISOString(),
        })),
      },
    };
  } catch (cause) {
    return failure(
      'store_unavailable',
      `The workspace roster could not be read: ${messageOf(cause)}. This is a transport or authentication failure, not a bad argument. Retry once; if it persists, report it rather than guessing at who is on the team.`,
      { limit },
    );
  }
}

export const teamTool: ToolDefinition<TeamInput> = {
  name: TOOL,
  title: 'List who is in this workspace and can receive a handoff',
  description:
    'Return every actor in this workspace — the people and the agents — with the id, name, email, and kind that mneia_handoff_create accepts as toActor. Call it before addressing a handoff to a teammate, and when you need to say who did something rather than printing a bare id. Humans come first. Read-only: it writes nothing and confirms nothing.',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseTeamInput,
  run,
};
