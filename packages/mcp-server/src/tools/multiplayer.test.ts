import type {
  Actor,
  ActorKind,
  Handoff,
  Project,
  ProjectSessionSummary,
  ScopedStore,
  Session,
} from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import { handoffInboxTool } from './handoff.js';
import { sessionsTool } from './sessions.js';
import { teamTool } from './team.js';
import type { ToolContext } from './types.js';

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';
const VIEWER = '55555555-5555-4555-8555-555555555555';
const TEAMMATE = '77777777-7777-4777-8777-777777777777';
const SESSION_A = '88888888-8888-4888-8888-888888888888';
const SESSION_B = '99999999-9999-4999-8999-999999999999';
const HANDOFF_MINE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HANDOFF_OPEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HANDOFF_THEIRS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW = new Date('2026-08-08T12:00:00.000Z');

const actorOf = (
  id: string,
  displayName: string,
  kind: ActorKind,
  externalRef: string | null = null,
): Actor => ({ id, workspaceId: WORKSPACE, kind, displayName, externalRef, createdAt: NOW });

const ROSTER: readonly Actor[] = [
  actorOf(AGENT, 'claude-code', 'agent'),
  actorOf(VIEWER, 'Alex Rivera', 'human', 'alex@example.com'),
  actorOf(TEAMMATE, 'Priya Nair', 'human', 'priya@example.com'),
];

const PROJECT: Project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE,
  teamId: null,
  slug: 'payments-migration',
  repoUrl: null,
  createdAt: NOW,
};

const sessionOf = (id: string, actorId: string, startedAt: string): Session => ({
  id,
  workspaceId: WORKSPACE,
  projectId: PROJECT_ID,
  actorId,
  tool: 'mcp',
  clientName: 'cursor',
  clientVersion: '1.4.0',
  clientSessionRef: null,
  clientSessionName: null,
  startedAt: new Date(startedAt),
  endedAt: null,
});

const SESSIONS: readonly ProjectSessionSummary[] = [
  {
    session: sessionOf(SESSION_A, TEAMMATE, '2026-08-01T09:00:00.000Z'),
    actor: actorOf(TEAMMATE, 'Priya Nair', 'human', 'priya@example.com'),
    checkpointCount: 3,
    itemCount: 12,
  },
  {
    session: sessionOf(SESSION_B, VIEWER, '2026-08-07T09:00:00.000Z'),
    actor: actorOf(VIEWER, 'Alex Rivera', 'human', 'alex@example.com'),
    checkpointCount: 1,
    itemCount: 4,
  },
];

const handoffOf = (id: string, fromActor: string, toActor: string | null): Handoff => ({
  id,
  workspaceId: WORKSPACE,
  projectId: PROJECT_ID,
  fromActor,
  toActor,
  createdAt: NOW,
  receivedAt: null,
  nextAction: 'Wire the retry path in charges/worker.rb to the new idempotency key.',
  rendered: '# Handoff\n',
});

const contextWith = (store: Record<string, unknown> = {}): ToolContext =>
  ({
    store: {
      scope: { workspaceId: WORKSPACE, actorId: VIEWER },
      getProject: vi.fn(async () => PROJECT),
      getProjectBySlug: vi.fn(async () => PROJECT),
      listWorkspaceActors: vi.fn(async () => ROSTER),
      listProjectSessions: vi.fn(async () => SESSIONS),
      listInboxHandoffs: vi.fn(async () => [
        handoffOf(HANDOFF_MINE, TEAMMATE, VIEWER),
        handoffOf(HANDOFF_OPEN, AGENT, null),
        handoffOf(HANDOFF_THEIRS, VIEWER, TEAMMATE),
      ]),
      ...store,
    } as unknown as ScopedStore,
    now: () => NOW,
    defaultProject: 'payments-migration',
  }) as unknown as ToolContext;

const textOf = (result: { content: readonly { text: string }[] }): string =>
  result.content.map((block) => block.text).join('\n');

describe('mneia_team', () => {
  it('lists the roster humans first, marks the caller, and shows the id a handoff can address', async () => {
    const result = await teamTool.run(teamTool.parse({}), contextWith());

    expect(result.isError).toBeUndefined();
    const text = textOf(result);
    expect(text.indexOf('Alex Rivera')).toBeLessThan(text.indexOf('claude-code'));
    expect(text).toContain('· you');
    expect(text).toContain('alex@example.com');
    expect(result.structuredContent).toMatchObject({ status: 'ok', count: 3, viewerId: VIEWER });
  });

  it('records the kind of every actor, so a reader can tell a human from an agent', async () => {
    const result = await teamTool.run(teamTool.parse({}), contextWith());
    const structured = result.structuredContent as { actors: readonly Record<string, unknown>[] };

    expect(structured.actors.map((actor) => actor.kind)).toEqual(['human', 'human', 'agent']);
    expect(structured.actors.every((actor) => typeof actor.human === 'boolean')).toBe(true);
  });

  it('refuses a limit outside the roster bounds at the trust boundary', () => {
    expect(() => teamTool.parse({ limit: 0 })).toThrow(/limit must be at least 1/);
    expect(() => teamTool.parse({ limit: 5000 })).toThrow(/limit must be at most 500/);
  });

  it('does not claim the workspace is empty when the roster call failed', async () => {
    const result = await teamTool.run(
      teamTool.parse({}),
      contextWith({
        listWorkspaceActors: vi.fn(async () => {
          throw new Error('socket hang up');
        }),
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'store_unavailable' } });
    expect(textOf(result)).toContain('rather than guessing at who is on the team');
  });
});

describe('mneia_sessions', () => {
  it('lists this project sessions most recent first, naming who ran each one', async () => {
    const result = await sessionsTool.run(sessionsTool.parse({}), contextWith());

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      sessions: readonly { id: string; actor: { displayName: string; kind: string } }[];
    };
    expect(structured.sessions.map((entry) => entry.id)).toEqual([SESSION_B, SESSION_A]);
    expect(structured.sessions[0]?.actor.displayName).toBe('Alex Rivera');
    expect(textOf(result)).toContain('Priya Nair (human)');
    expect(textOf(result)).toContain('cursor 1.4.0');
  });

  it('carries the checkpoint and item counts that say how much a session wrote', async () => {
    const result = await sessionsTool.run(sessionsTool.parse({}), contextWith());

    expect(textOf(result)).toContain('3 checkpoints · 12 items');
  });

  it('says which project is missing when none is supplied and none is bound', async () => {
    const context = { ...contextWith(), defaultProject: null } as ToolContext;

    const result = await sessionsTool.run(sessionsTool.parse({}), context);

    expect(result.structuredContent).toMatchObject({ error: { code: 'project_not_bound' } });
  });

  it('reports an unknown project rather than an empty session list', async () => {
    const result = await sessionsTool.run(
      sessionsTool.parse({ project: 'nope' }),
      contextWith({ getProjectBySlug: vi.fn(async () => null) }),
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'project_not_found' } });
  });
});

describe('mneia_handoff_inbox', () => {
  it('separates what is addressed to the caller from what is open to anyone', async () => {
    const result = await handoffInboxTool.run(handoffInboxTool.parse({}), contextWith());

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      addressed: readonly { id: string }[];
      open: readonly { id: string }[];
    };
    expect(structured.addressed.map((entry) => entry.id)).toEqual([HANDOFF_MINE]);
    expect(structured.open.map((entry) => entry.id)).toEqual([HANDOFF_OPEN]);
  });

  it('leaves out a handoff addressed to somebody else rather than offering it', async () => {
    const result = await handoffInboxTool.run(handoffInboxTool.parse({}), contextWith());

    expect(textOf(result)).not.toContain(HANDOFF_THEIRS);
  });

  it('names who froze each handoff instead of printing a bare actor id', async () => {
    const result = await handoffInboxTool.run(handoffInboxTool.parse({}), contextWith());

    expect(textOf(result)).toContain('from Priya Nair (human)');
    expect(textOf(result)).toContain('from claude-code (agent)');
  });

  it('says plainly that nothing is waiting rather than returning an empty block', async () => {
    const result = await handoffInboxTool.run(
      handoffInboxTool.parse({}),
      contextWith({ listInboxHandoffs: vi.fn(async () => []) }),
    );

    expect(textOf(result)).toContain('Nothing is waiting for you on payments-migration');
  });

  it('does not claim the inbox is empty when the call failed', async () => {
    const result = await handoffInboxTool.run(
      handoffInboxTool.parse({}),
      contextWith({
        listInboxHandoffs: vi.fn(async () => {
          throw new Error('socket hang up');
        }),
      }),
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('rather than assuming nothing is waiting for you');
  });

  it('refuses a limit outside the inbox bounds at the trust boundary', () => {
    expect(() => handoffInboxTool.parse({ limit: 0 })).toThrow(/limit must be at least 1/);
    expect(() => handoffInboxTool.parse({ limit: 1000 })).toThrow(/limit must be at most 200/);
  });
});
