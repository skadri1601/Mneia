import type { Handoff } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import type { CommandInvocation } from '../command.js';
import type { ProjectConfig } from './brief.js';
import { createHandoffCommand, type HandoffApi } from './handoff.js';
import { createPickupCommand } from './pickup.js';

const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SENDER = '44444444-4444-4444-8444-444444444444';
const HANDOFF_ID = '66666666-6666-4666-8666-666666666666';
const CREATED_AT = new Date('2026-08-08T12:00:00.000Z');

const config = {
  endpoint: 'https://app.mneia.dev',
  project: 'payments-migration',
  workspace: 'acme',
  configPath: '/repo/.mneia/config.json',
} as unknown as ProjectConfig;

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

const harness = (overrides: Partial<HandoffApi> = {}) => {
  const out: string[] = [];
  const err: string[] = [];

  const api = {
    create: vi.fn(async () => handoff()),
    receive: vi.fn(async () => handoff({ receivedAt: CREATED_AT, toActor: SENDER })),
    listOpen: vi.fn(async () => [handoff()]),
    ...overrides,
  } as unknown as HandoffApi;

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

  const deps = { api, loadConfig: () => config };
  return { api, out, err, invocation, deps };
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

  it('passes the recipient through when one is named', async () => {
    const { deps, invocation, api } = harness();

    await createHandoffCommand(deps).run(invocation(['Wire it.'], { to: SENDER }));

    expect(api.create).toHaveBeenCalledWith(expect.objectContaining({ toActor: SENDER }));
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
  it('lists the open handoffs when no id is given', async () => {
    const { deps, invocation, out, api } = harness();

    const code = await createPickupCommand(deps).run(invocation([]));

    expect(code).toBe(0);
    expect(api.receive).not.toHaveBeenCalled();
    expect(out.join('')).toContain('1 open handoff');
    expect(out.join('')).toContain(HANDOFF_ID);
  });

  it('says what to do when nothing is waiting, instead of printing an empty list', async () => {
    const { deps, invocation, out } = harness({ listOpen: vi.fn(async () => []) });

    await createPickupCommand(deps).run(invocation([]));

    expect(out.join('')).toContain('No open handoff on this project.');
    expect(out.join('')).toContain('mneia handoff');
  });

  it('receives a named handoff and prints the frozen artifact it was given', async () => {
    const { deps, invocation, out, api } = harness();

    await createPickupCommand(deps).run(invocation([HANDOFF_ID]));

    expect(api.receive).toHaveBeenCalledWith(expect.objectContaining({ id: HANDOFF_ID }));
    expect(out.join('')).toContain('# Handoff: payments-migration');
    expect(out.join('')).toContain('received: 2026-08-08T12:00:00.000Z');
  });

  it('refuses more than one handoff id', async () => {
    const { deps, invocation } = harness();

    await expect(
      createPickupCommand(deps).run(invocation([HANDOFF_ID, HANDOFF_ID])),
    ).rejects.toThrow(/takes one handoff id/);
  });
});
