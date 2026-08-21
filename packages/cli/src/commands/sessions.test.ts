import type { Actor, ProjectSessionSummary, Session } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import type { CommandInvocation } from '../command.js';
import type { ProjectConfig } from './brief.js';
import {
  createSessionsCommand,
  describeClient,
  describeWindow,
  orderSessions,
  type SessionsApi,
} from './sessions.js';

const WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const VIEWER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';

const config = {
  endpoint: 'https://app.mneia.dev',
  project: 'payments-migration',
  workspace: 'acme',
  configPath: '/repo/.mneia/config.json',
} as unknown as ProjectConfig;

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  id: VIEWER,
  workspaceId: WORKSPACE_ID,
  kind: 'human',
  displayName: 'Saad Kadri',
  externalRef: 'saad@acme.dev',
  createdAt: new Date('2026-08-01T09:00:00.000Z'),
  ...overrides,
});

const session = (overrides: Partial<Session> = {}): Session => ({
  id: '44444444-4444-4444-8444-444444444444',
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  actorId: VIEWER,
  tool: 'claude-code',
  clientName: 'claude-code',
  clientVersion: '1.0.44',
  clientSessionRef: '7f2a9c11',
  clientSessionName: 'Wire the retry path',
  clientSessionUrl: null,
  startedAt: new Date('2026-08-20T14:02:00.000Z'),
  endedAt: new Date('2026-08-20T16:41:00.000Z'),
  ...overrides,
});

const MINE: ProjectSessionSummary = {
  session: session(),
  actor: actor(),
  checkpointCount: 3,
  itemCount: 12,
};

const THEIRS: ProjectSessionSummary = {
  session: session({
    id: '55555555-5555-4555-8555-555555555555',
    actorId: AGENT,
    tool: 'cursor',
    clientName: 'cursor',
    clientVersion: null,
    clientSessionName: null,
    clientSessionRef: 'abc123',
    startedAt: new Date('2026-08-19T09:10:00.000Z'),
    endedAt: null,
  }),
  actor: actor({ id: AGENT, kind: 'agent', displayName: 'Claude Code', externalRef: null }),
  checkpointCount: 0,
  itemCount: 0,
};

const harness = (sessions: readonly ProjectSessionSummary[] = [THEIRS, MINE]) => {
  const out: string[] = [];
  const err: string[] = [];

  const api: SessionsApi = {
    sessions: vi.fn(async () => ({
      projectId: PROJECT_ID,
      viewerId: VIEWER,
      sessions: [...sessions],
    })),
  };

  const invocation = (
    args: readonly string[] = [],
    flags: Record<string, string | boolean> = {},
    json = false,
  ): CommandInvocation => ({
    args,
    flags,
    json,
    io: {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => err.push(text),
      cwd: '/repo',
      env: {},
    },
  });

  return { api, out, err, invocation, deps: { api, loadConfig: () => config } };
};

describe('orderSessions', () => {
  it('puts the newest session first', () => {
    expect(orderSessions([THEIRS, MINE]).map((entry) => entry.session.id)).toEqual([
      MINE.session.id,
      THEIRS.session.id,
    ]);
  });
});

describe('describeWindow', () => {
  it('shortens the end of a same-day session to a time', () => {
    expect(describeWindow(MINE)).toBe('2026-08-20 14:02 → 16:41');
  });

  it('says a session with no end is still open', () => {
    expect(describeWindow(THEIRS)).toBe('2026-08-19 09:10 → still open');
  });
});

describe('describeClient', () => {
  it('carries the client name, version, session name, and ref', () => {
    expect(describeClient(MINE)).toBe('claude-code 1.0.44 · "Wire the retry path" · ref 7f2a9c11');
  });

  it('says plainly when the client was never recorded', () => {
    expect(
      describeClient({
        ...THEIRS,
        session: session({
          tool: null,
          clientName: null,
          clientSessionName: null,
          clientSessionRef: null,
        }),
      }),
    ).toBe('client not recorded · no session ref');
  });
});

describe('mneia sessions', () => {
  it('shows who worked here, from which client, and what came out of it', async () => {
    const { deps, invocation, out } = harness();

    const code = await createSessionsCommand(deps).run(invocation());

    expect(code).toBe(0);
    const printed = out.join('');
    expect(printed).toContain('Saad Kadri (human) · you');
    expect(printed).toContain('Claude Code (agent)');
    expect(printed).toContain('claude-code 1.0.44');
    expect(printed).toContain('3 checkpoints · 12 context items');
    expect(printed).toContain('no checkpoints yet · no context items');
  });

  it('counts humans and agents separately in the headline', async () => {
    const { deps, invocation, out } = harness();

    await createSessionsCommand(deps).run(invocation());

    expect(out.join('')).toContain('2 sessions · 1 human · 1 agent · 3 checkpoints');
  });

  it('says what to do when nobody has worked here yet', async () => {
    const { deps, invocation, out } = harness([]);

    await createSessionsCommand(deps).run(invocation());

    expect(out.join('')).toContain('No agent sessions have been recorded');
    expect(out.join('')).toContain('mneia checkpoint');
  });

  it('marks your own sessions under --json as well', async () => {
    const { deps, invocation, out } = harness();

    await createSessionsCommand(deps).run(invocation([], {}, true));

    expect(JSON.parse(out.join(''))).toMatchObject({
      project: 'acme/payments-migration',
      count: 2,
      sessions: [
        {
          clientName: 'claude-code',
          checkpointCount: 3,
          actor: { displayName: 'Saad Kadri', kind: 'human', human: true, you: true },
        },
        {
          clientName: 'cursor',
          endedAt: null,
          actor: { displayName: 'Claude Code', kind: 'agent', human: false, you: false },
        },
      ],
    });
  });

  it('rejects a limit above the cap', async () => {
    const { deps, invocation } = harness();

    await expect(createSessionsCommand(deps).run(invocation([], { limit: '500' }))).rejects.toThrow(
      /capped at 200 sessions/,
    );
  });
});
