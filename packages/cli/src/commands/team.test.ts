import type { Actor } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import type { CommandInvocation } from '../command.js';
import type { ProjectConfig } from './brief.js';
import {
  createTeamCommand,
  matchActors,
  orderRoster,
  type Roster,
  resolveActorReference,
  type TeamApi,
} from './team.js';

const VIEWER = '11111111-1111-4111-8111-111111111111';
const PRIYA = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = new Date('2026-08-01T09:00:00.000Z');

const config = {
  endpoint: 'https://app.mneia.dev',
  project: 'payments-migration',
  workspace: 'acme',
  configPath: '/repo/.mneia/config.json',
} as unknown as ProjectConfig;

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  id: VIEWER,
  workspaceId: '99999999-9999-4999-8999-999999999999',
  kind: 'human',
  displayName: 'Saad Kadri',
  externalRef: 'saad@acme.dev',
  createdAt: CREATED_AT,
  ...overrides,
});

const ROSTER: readonly Actor[] = [
  actor({ id: AGENT, kind: 'agent', displayName: 'Claude Code', externalRef: null }),
  actor(),
  actor({ id: PRIYA, displayName: 'Priya Raman', externalRef: 'priya@acme.dev' }),
];

const roster = (actors: readonly Actor[] = ROSTER): Roster => ({
  viewerId: VIEWER,
  actors: [...actors],
});

const harness = (actors: readonly Actor[] = ROSTER) => {
  const out: string[] = [];
  const err: string[] = [];

  const api: TeamApi = { roster: vi.fn(async () => roster(actors)) };

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

describe('orderRoster', () => {
  it('puts humans before agents, then sorts by name', () => {
    expect(orderRoster(ROSTER).map((entry) => entry.displayName)).toEqual([
      'Priya Raman',
      'Saad Kadri',
      'Claude Code',
    ]);
  });
});

describe('matchActors', () => {
  it('prefers an exact name over a prefix of another', () => {
    const actors = [
      actor({ id: PRIYA, displayName: 'Sam', externalRef: null }),
      actor({ id: AGENT, displayName: 'Samantha', externalRef: null }),
    ];

    expect(matchActors(actors, 'Sam').map((match) => match.actor.id)).toEqual([PRIYA]);
  });

  it('ignores a hex fragment shorter than four characters', () => {
    expect(matchActors(ROSTER, '22')).toHaveLength(0);
  });
});

describe('resolveActorReference', () => {
  it('resolves a full uuid', () => {
    expect(resolveActorReference(PRIYA, roster(), '--to').id).toBe(PRIYA);
  });

  it('resolves an agent by name, so a handoff can be addressed to one', () => {
    expect(resolveActorReference('Claude Code', roster(), '--to').id).toBe(AGENT);
  });

  it('says what it received and points at mneia team when nobody matches', () => {
    expect(() => resolveActorReference('zoltan', roster(), '--to')).toThrow(
      /nobody there matches "zoltan"/,
    );
  });
});

describe('mneia team', () => {
  it('marks human against agent in text, not by colour', async () => {
    const { deps, invocation, out } = harness();

    const code = await createTeamCommand(deps).run(invocation());

    expect(code).toBe(0);
    const printed = out.join('');
    expect(printed).toContain('Priya Raman');
    expect(printed).toMatch(/Claude Code\s+agent/);
    expect(printed).toMatch(/Saad Kadri\s+human · you/);
  });

  it('prints a short id that --to accepts', async () => {
    const { deps, invocation, out } = harness();

    await createTeamCommand(deps).run(invocation());

    expect(out.join('')).toContain('[22222222]');
    expect(out.join('')).toContain('mneia handoff "<next action>" --to');
  });

  it('reports the roster under --json with an explicit human flag', async () => {
    const { deps, invocation, out } = harness();

    await createTeamCommand(deps).run(invocation([], {}, true));

    expect(JSON.parse(out.join(''))).toMatchObject({
      workspace: 'acme',
      viewerId: VIEWER,
      count: 3,
      actors: [
        { displayName: 'Priya Raman', kind: 'human', human: true, you: false },
        { displayName: 'Saad Kadri', kind: 'human', human: true, you: true },
        { displayName: 'Claude Code', kind: 'agent', human: false, you: false },
      ],
    });
  });

  it('rejects a limit that is not a positive whole number', async () => {
    const { deps, invocation } = harness();

    await expect(createTeamCommand(deps).run(invocation([], { limit: '0' }))).rejects.toThrow(
      /positive whole number of actors/,
    );
  });

  it('refuses positional arguments', async () => {
    const { deps, invocation } = harness();

    await expect(createTeamCommand(deps).run(invocation(['priya']))).rejects.toThrow(
      /takes no positional arguments/,
    );
  });
});
