import type { Actor, Handoff } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import type { CommandInvocation } from '../command.js';
import type { ProjectConfig } from './brief.js';
import { createHandoffCommand, type HandoffApi, type HandoffInbox } from './handoff.js';
import { createPickupCommand } from './pickup.js';
import type { TeamApi } from './team.js';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SENDER = '44444444-4444-4444-8444-444444444444';
const VIEWER = '55555555-5555-4555-8555-555555555555';
const PRIYA = '77777777-7777-4777-8777-777777777777';
const AGENT = '88888888-8888-4888-8888-888888888888';
const HANDOFF_ID = '66666666-6666-4666-8666-666666666666';
const OPEN_HANDOFF_ID = '99999999-9999-4999-8999-999999999999';
const OTHERS_HANDOFF_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATED_AT = new Date('2026-08-08T12:00:00.000Z');

const config = {
  endpoint: 'https://app.mneia.dev',
  project: 'payments-migration',
  workspace: 'acme',
  configPath: '/repo/.mneia/config.json',
} as unknown as ProjectConfig;

const actor = (overrides: Partial<Actor> = {}): Actor => ({
  id: VIEWER,
  workspaceId: '22222222-2222-4222-8222-222222222222',
  kind: 'human',
  displayName: 'Saad Kadri',
  externalRef: 'saad@acme.dev',
  createdAt: CREATED_AT,
  ...overrides,
});

const ROSTER: readonly Actor[] = [
  actor(),
  actor({ id: PRIYA, displayName: 'Priya Raman', externalRef: 'priya@acme.dev' }),
  actor({ id: AGENT, kind: 'agent', displayName: 'Claude Code', externalRef: null }),
  actor({ id: SENDER, displayName: 'Sam Okafor', externalRef: 'sam@acme.dev' }),
];

const handoff = (overrides: Partial<Handoff> = {}): Handoff => ({
  id: HANDOFF_ID,
  workspaceId: '22222222-2222-4222-8222-222222222222',
  projectId: PROJECT_ID,
  fromActor: SENDER,
  toActor: null,
  createdAt: CREATED_AT,
  receivedAt: null,
  nextAction: 'Wire the retry path to the new idempotency key.',
  rendered: '# Handoff: payments-migration\n\n## Next action\nWire the retry path.',
  ...overrides,
});

const inbox = (overrides: Partial<HandoffInbox> = {}): HandoffInbox => ({
  viewerId: VIEWER,
  addressed: [handoff({ id: HANDOFF_ID, toActor: VIEWER })],
  open: [handoff({ id: OPEN_HANDOFF_ID, nextAction: 'Finish the dual-read cutover.' })],
  actors: [...ROSTER],
  ...overrides,
});

const harness = (overrides: Partial<HandoffApi> = {}, actors: readonly Actor[] = ROSTER) => {
  const out: string[] = [];
  const err: string[] = [];

  const api = {
    create: vi.fn(async () => handoff()),
    receive: vi.fn(async () => handoff({ receivedAt: CREATED_AT, toActor: VIEWER })),
    inbox: vi.fn(async () => inbox()),
    ...overrides,
  } as unknown as HandoffApi;

  const team: TeamApi = {
    roster: vi.fn(async () => ({ viewerId: VIEWER, actors: [...actors] })),
  };

  const invocation = (
    args: readonly string[],
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

  const deps = { api, team, loadConfig: () => config };
  return { api, team, out, err, invocation, deps };
};

describe('mneia handoff', () => {
  it('prints the frozen artifact and the command the receiver runs', async () => {
    const { deps, invocation, out } = harness();

    const code = await createHandoffCommand(deps).run(
      invocation(['Wire', 'the', 'retry', 'path.']),
    );

    expect(code).toBe(0);
    expect(out.join('')).toContain('# Handoff: payments-migration');
    expect(out.join('')).toContain(`mneia pickup ${HANDOFF_ID}`);
  });

  it('says an unaddressed handoff is open, rather than leaving the recipient blank', async () => {
    const { deps, invocation, out } = harness();

    await createHandoffCommand(deps).run(invocation(['Wire the retry path.']));

    expect(out.join('')).toContain('to: open — anyone may pick it up');
  });

  it('refuses without a next action, because a handoff without one transfers nothing', async () => {
    const { deps, invocation, api } = harness();

    await expect(createHandoffCommand(deps).run(invocation([]))).rejects.toThrow(
      /one concrete thing/,
    );
    expect(api.create).not.toHaveBeenCalled();
  });

  it('resolves --to from a teammate name instead of demanding a uuid', async () => {
    const { deps, invocation, api } = harness({
      create: vi.fn(async () => handoff({ toActor: PRIYA })),
    });

    await createHandoffCommand(deps).run(invocation(['Wire it.'], { to: 'Priya Raman' }));

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ toActor: PRIYA }));
  });

  it('resolves --to from an email address', async () => {
    const { deps, invocation, api } = harness({
      create: vi.fn(async () => handoff({ toActor: PRIYA })),
    });

    await createHandoffCommand(deps).run(invocation(['Wire it.'], { to: 'priya@acme.dev' }));

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ toActor: PRIYA }));
  });

  it('resolves --to from the short id mneia team prints', async () => {
    const { deps, invocation, api } = harness({
      create: vi.fn(async () => handoff({ toActor: PRIYA })),
    });

    await createHandoffCommand(deps).run(invocation(['Wire it.'], { to: '77777777' }));

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ toActor: PRIYA }));
  });

  it('still accepts a full uuid', async () => {
    const { deps, invocation, api } = harness({
      create: vi.fn(async () => handoff({ toActor: PRIYA })),
    });

    await createHandoffCommand(deps).run(invocation(['Wire it.'], { to: PRIYA }));

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ toActor: PRIYA }));
  });

  it('lists the candidates when the recipient is ambiguous, rather than guessing', async () => {
    const roster = [
      actor({ id: PRIYA, displayName: 'Sam Okafor', externalRef: 'sam.o@acme.dev' }),
      actor({ id: SENDER, displayName: 'Sam Okonkwo', externalRef: 'sam.k@acme.dev' }),
    ];
    const { deps, invocation, api } = harness({}, roster);

    await expect(
      createHandoffCommand(deps).run(invocation(['Wire it.'], { to: 'sam' })),
    ).rejects.toThrow(/matched 2 actors for "sam".*Sam Okafor.*Sam Okonkwo/s);
    expect(api.create).not.toHaveBeenCalled();
  });

  it('names what it received and points at mneia team when nobody matches', async () => {
    const { deps, invocation, api } = harness();

    await expect(
      createHandoffCommand(deps).run(invocation(['Wire it.'], { to: 'nobody-here' })),
    ).rejects.toThrow(/nobody there matches "nobody-here"/);
    await expect(
      createHandoffCommand(deps).run(invocation(['Wire it.'], { to: 'nobody-here' })),
    ).rejects.toMatchObject({ fix: expect.stringContaining('mneia team') });
    expect(api.create).not.toHaveBeenCalled();
  });

  it('renders the recipient by name rather than as a bare uuid', async () => {
    const { deps, invocation, out } = harness({
      create: vi.fn(async () => handoff({ toActor: PRIYA })),
    });

    await createHandoffCommand(deps).run(invocation(['Wire it.'], { to: 'priya@acme.dev' }));

    expect(out.join('')).toContain('to: Priya Raman (human) [77777777]');
  });

  it('carries the recipient name into --json as well', async () => {
    const { deps, invocation, out } = harness({
      create: vi.fn(async () => handoff({ toActor: PRIYA })),
    });

    await createHandoffCommand(deps).run(invocation(['Wire it.'], { to: 'Priya Raman' }, true));

    expect(JSON.parse(out.join(''))).toMatchObject({
      toActor: { id: PRIYA, displayName: 'Priya Raman', kind: 'human', human: true },
    });
  });

  it('rejects a superseded window that is not a positive whole number of days', async () => {
    const { deps, invocation } = harness();

    await expect(
      createHandoffCommand(deps).run(invocation(['Wire it.'], { window: '0' })),
    ).rejects.toThrow(/positive whole number of days/);
  });

  it('emits machine-readable output under --json', async () => {
    const { deps, invocation, out } = harness();

    await createHandoffCommand(deps).run(invocation(['Wire it.'], {}, true));

    expect(JSON.parse(out.join(''))).toMatchObject({ id: HANDOFF_ID, toActor: null });
  });
});

describe('mneia pickup', () => {
  it('separates what is addressed to you from what is open to anyone', async () => {
    const { deps, invocation, out, api } = harness();

    const code = await createPickupCommand(deps).run(invocation([]));

    expect(code).toBe(0);
    expect(api.receive).not.toHaveBeenCalled();
    const printed = out.join('');
    expect(printed).toContain('addressed to you (1)');
    expect(printed).toContain('open — anyone may pick it up (1)');
    expect(printed).toContain('from Sam Okafor (human)');
  });

  it('says what to do when nothing is waiting, instead of printing an empty list', async () => {
    const { deps, invocation, out } = harness({
      inbox: vi.fn(async () => inbox({ addressed: [], open: [] })),
    });

    await createPickupCommand(deps).run(invocation([]));

    expect(out.join('')).toContain('Nothing is waiting on acme/payments-migration');
    expect(out.join('')).toContain('mneia handoff');
  });

  it('receives a handoff addressed to you and prints who handed it over', async () => {
    const { deps, invocation, out, api } = harness();

    await createPickupCommand(deps).run(invocation([HANDOFF_ID]));

    expect(api.receive).toHaveBeenCalledWith(expect.objectContaining({ id: HANDOFF_ID }));
    expect(out.join('')).toContain('# Handoff: payments-migration');
    expect(out.join('')).toContain('handed over by: Sam Okafor (human)');
  });

  it('accepts the short id it printed', async () => {
    const { deps, invocation, api } = harness();

    await createPickupCommand(deps).run(invocation(['66666666']));

    expect(api.receive).toHaveBeenCalledWith(expect.objectContaining({ id: HANDOFF_ID }));
  });

  it('refuses a handoff addressed to somebody else instead of crashing', async () => {
    const { deps, invocation, api } = harness({
      inbox: vi.fn(async () =>
        inbox({
          addressed: [],
          open: [],
        }),
      ),
    });

    await expect(createPickupCommand(deps).run(invocation([OTHERS_HANDOFF_ID]))).rejects.toThrow(
      /addressed to somebody else, or already received/,
    );
    expect(api.receive).not.toHaveBeenCalled();
  });

  it('refuses one that reached the inbox but is addressed elsewhere', async () => {
    const { deps, invocation, api } = harness({
      inbox: vi.fn(async () =>
        inbox({
          addressed: [],
          open: [handoff({ id: OTHERS_HANDOFF_ID, toActor: PRIYA })],
        }),
      ),
    });

    await expect(createPickupCommand(deps).run(invocation([OTHERS_HANDOFF_ID]))).rejects.toThrow(
      /is addressed to another actor/,
    );
    expect(api.receive).not.toHaveBeenCalled();
  });

  it('refuses more than one handoff id', async () => {
    const { deps, invocation } = harness();

    await expect(
      createPickupCommand(deps).run(invocation([HANDOFF_ID, HANDOFF_ID])),
    ).rejects.toThrow(/takes one handoff id/);
  });

  it('reports the inbox as two groups under --json', async () => {
    const { deps, invocation, out } = harness();

    await createPickupCommand(deps).run(invocation([], {}, true));

    expect(JSON.parse(out.join(''))).toMatchObject({
      viewerId: VIEWER,
      count: 2,
      addressedToYou: [{ id: HANDOFF_ID, addressedToYou: true }],
      open: [{ id: OPEN_HANDOFF_ID, addressedToYou: false }],
    });
  });

  it('reads a handoff with --read without receiving it', async () => {
    const { deps, api, out, invocation } = harness();

    const code = await createPickupCommand(deps).run(invocation([HANDOFF_ID], { read: true }));

    expect(code).toBe(0);
    expect(api.receive).not.toHaveBeenCalled();
    expect(out.join('\n')).toContain('not received');
    expect(out.join('\n')).toContain(`mneia pickup ${HANDOFF_ID}`);
  });

  it('refuses a --read that carries a value', async () => {
    const { deps, invocation } = harness();

    await expect(
      createPickupCommand(deps).run(invocation([HANDOFF_ID], { read: 'yes' })),
    ).rejects.toThrow(/--read takes no value/);
  });

  it('still receives when --read is absent', async () => {
    const { deps, api, invocation } = harness();

    await createPickupCommand(deps).run(invocation([HANDOFF_ID]));

    expect(api.receive).toHaveBeenCalledTimes(1);
  });
});
