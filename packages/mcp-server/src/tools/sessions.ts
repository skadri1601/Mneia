import type { Project, ProjectSessionSummary, ScopedStore, Uuid } from '@mneia/core';
import { ApiError, shortenItemIds } from '@mneia/core';
import { z } from 'zod';
import { shortActorId, shortActorIds } from './actors.js';
import type { ToolContext, ToolDefinition, ToolResult } from './types.js';

const TOOL = 'mneia_sessions';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_SESSION_LIMIT = 50;
export const MAX_SESSION_LIMIT = 200;

const SessionsInputSchema = z.object({
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
    .int({ error: 'limit must be a whole number of sessions.' })
    .min(1, { error: 'limit must be at least 1.' })
    .max(MAX_SESSION_LIMIT, { error: `limit must be at most ${MAX_SESSION_LIMIT}.` })
    .optional()
    .describe(
      `How many sessions to return, most recently started first. Defaults to ${DEFAULT_SESSION_LIMIT}.`,
    ),
});

export type SessionsInput = z.infer<typeof SessionsInputSchema>;

const INPUT_JSON_SCHEMA: Record<string, unknown> = z.toJSONSchema(SessionsInputSchema, {
  target: 'draft-7',
  io: 'input',
});

export interface ProjectSessionFilterInput {
  readonly projectId: Uuid;
  readonly limit?: number;
}

interface SessionsCapableStore extends ScopedStore {
  listProjectSessions(filter: ProjectSessionFilterInput): Promise<readonly ProjectSessionSummary[]>;
}

const isSessionsCapable = (store: ScopedStore): store is SessionsCapableStore =>
  typeof (store as { listProjectSessions?: unknown }).listProjectSessions === 'function';

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function parseSessionsInput(raw: unknown): SessionsInput {
  const parsed = SessionsInputSchema.safeParse(raw ?? {});
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

const utcMinute = (value: Date): string => value.toISOString().replace('T', ' ').slice(0, 16);

async function resolveProject(context: ToolContext, project: string): Promise<Project | null> {
  return UUID_PATTERN.test(project)
    ? context.store.getProject(project)
    : context.store.getProjectBySlug(project);
}

export function orderSessions(
  summaries: readonly ProjectSessionSummary[],
): readonly ProjectSessionSummary[] {
  return [...summaries].sort((left, right) => {
    const byStart = right.session.startedAt.getTime() - left.session.startedAt.getTime();
    return byStart !== 0 ? byStart : left.session.id.localeCompare(right.session.id);
  });
}

function clientOf(summary: ProjectSessionSummary): string {
  const parts: string[] = [];
  const name = summary.session.clientName ?? summary.session.tool;
  if (name !== null && name !== undefined && name.trim().length > 0) {
    parts.push(name.trim());
  }
  const version = summary.session.clientVersion;
  if (version !== null && version !== undefined && version.trim().length > 0) {
    parts.push(version.trim());
  }
  return parts.length === 0 ? 'client not recorded' : parts.join(' ');
}

function sessionLine(
  summary: ProjectSessionSummary,
  shortIds: ReadonlyMap<Uuid, string>,
  viewerId: Uuid,
): string {
  const you = summary.actor.id === viewerId ? ' · you' : '';
  const ended =
    summary.session.endedAt === null ? 'open' : `ended ${utcMinute(summary.session.endedAt)} UTC`;
  const name = summary.session.clientSessionName;
  const label =
    name === null || name === undefined || name.trim().length === 0 ? '' : ` — ${name.trim()}`;

  return [
    `  [${shortIds.get(summary.session.id) ?? summary.session.id}]  ${utcMinute(summary.session.startedAt)} UTC · ${ended}${label}`,
    `      ${summary.actor.displayName} (${summary.actor.kind})${you} · ${clientOf(summary)}`,
    `      ${countOf(summary.checkpointCount, 'checkpoint')} · ${countOf(summary.itemCount, 'item')}`,
  ].join('\n');
}

function renderSessions(
  summaries: readonly ProjectSessionSummary[],
  project: Project,
  viewerId: Uuid,
): string {
  if (summaries.length === 0) {
    return `No sessions have been recorded on ${project.slug}. A session opens on the first write — checkpoint or assert once and it will appear here.`;
  }

  const ordered = orderSessions(summaries);
  const shortIds = shortenItemIds(ordered.map((summary) => summary.session.id));
  const actors = new Set(ordered.map((summary) => summary.actor.id));

  return [
    `${countOf(summaries.length, 'session')} on ${project.slug}, most recent first, run by ${countOf(actors.size, 'actor')}.`,
    '',
    ordered.map((summary) => sessionLine(summary, shortIds, viewerId)).join('\n'),
    '',
    'Every line names who ran the session and which client they ran it in — that is the provenance behind the items those sessions wrote.',
  ].join('\n');
}

async function run(input: SessionsInput, context: ToolContext): Promise<ToolResult> {
  const requested = input.project ?? context.defaultProject ?? undefined;

  if (requested === undefined) {
    return failure(
      'project_not_bound',
      'No project was supplied and this server has no project bound. Call the tool again with "project" set to the project slug, or run `mneia init` in the repository to bind one.',
    );
  }

  if (!isSessionsCapable(context.store)) {
    return failure(
      'unsupported',
      'This server is bound to a store that cannot list project sessions. Upgrade @mneia/mcp-server so its @mneia/core ships listProjectSessions, or read the sessions from the web app.',
      { project: requested },
    );
  }

  const limit = input.limit ?? DEFAULT_SESSION_LIMIT;

  try {
    const project = await resolveProject(context, requested);
    if (project === null) {
      return failure(
        'project_not_found',
        `No project matching "${requested}" is visible in this workspace. Check the slug, or call mneia_search to confirm the project exists before retrying.`,
        { project: requested },
      );
    }

    const summaries = await context.store.listProjectSessions({ projectId: project.id, limit });
    const ordered = orderSessions(summaries);
    const shortIds = shortenItemIds(ordered.map((summary) => summary.session.id));
    const actorShortIds = shortActorIds(ordered.map((summary) => summary.actor));
    const viewerId = context.store.scope.actorId;

    return {
      content: [{ type: 'text', text: renderSessions(summaries, project, viewerId) }],
      structuredContent: {
        status: 'ok',
        projectId: project.id,
        projectSlug: project.slug,
        viewerId,
        limit,
        count: summaries.length,
        sessions: ordered.map((summary) => ({
          id: summary.session.id,
          shortId: shortIds.get(summary.session.id) ?? summary.session.id,
          startedAt: summary.session.startedAt.toISOString(),
          endedAt: summary.session.endedAt === null ? null : summary.session.endedAt.toISOString(),
          tool: summary.session.tool,
          clientName: summary.session.clientName ?? null,
          clientVersion: summary.session.clientVersion ?? null,
          clientSessionRef: summary.session.clientSessionRef ?? null,
          clientSessionName: summary.session.clientSessionName ?? null,
          checkpointCount: summary.checkpointCount,
          itemCount: summary.itemCount,
          actor: {
            id: summary.actor.id,
            shortId: shortActorId(summary.actor, actorShortIds),
            displayName: summary.actor.displayName,
            kind: summary.actor.kind,
            human: summary.actor.kind === 'human',
            externalRef: summary.actor.externalRef,
            you: summary.actor.id === viewerId,
          },
        })),
      },
    };
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'not_found') {
      return failure('project_not_found', cause.message, { project: requested });
    }
    return failure(
      'store_unavailable',
      `The sessions on this project could not be read: ${messageOf(cause)}. This is a transport or authentication failure, not a bad argument. Retry once; if it persists, report it rather than assuming nobody else has worked here.`,
      { project: requested, limit },
    );
  }
}

export const sessionsTool: ToolDefinition<SessionsInput> = {
  name: TOOL,
  title: 'List the sessions recorded on this project and who ran them',
  description:
    'Return the working sessions this project has seen, most recent first, each with the actor who ran it, the client they ran it in, and how much it wrote — checkpoints and items. Call it to find out whether somebody else has been in this repository before you start, and to attribute an item or a decision to a person rather than to a bare id. A session opens on the first write, so a session appearing here means real work landed. Read-only.',
  inputSchema: INPUT_JSON_SCHEMA,
  parse: parseSessionsInput,
  run,
};
