import type { Handoff, ScopedStore } from '@mneia/core';
import { ApiError } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import { handoffCreateTool, handoffReceiveTool } from './handoff.js';
import type { ToolContext } from './types.js';

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SENDER = '44444444-4444-4444-8444-444444444444';
const RECEIVER = '55555555-5555-4555-8555-555555555555';
const HANDOFF_ID = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-08-08T12:00:00.000Z');

const NEXT_ACTION = 'Wire the retry path in charges/worker.rb to the new idempotency key.';

const handoff = (overrides: Partial<Handoff> = {}): Handoff => ({
  id: HANDOFF_ID,
  workspaceId: WORKSPACE,
  projectId: PROJECT_ID,
  fromActor: SENDER,
  toActor: null,
  createdAt: NOW,
  receivedAt: null,
  nextAction: NEXT_ACTION,
  rendered: '# Handoff: payments-migration\n\n## Next action\nWire the retry path.',
  ...overrides,
});

const contextWith = (store: Partial<ScopedStore> & Record<string, unknown> = {}): ToolContext =>
  ({
    store: {
      scope: { workspaceId: WORKSPACE, actorId: RECEIVER },
      handoff: vi.fn(async () => handoff()),
      receiveHandoff: vi.fn(async () => handoff({ receivedAt: NOW, toActor: RECEIVER })),
      ...store,
    } as unknown as ScopedStore,
    now: () => NOW,
    defaultProject: 'payments-migration',
  }) as unknown as ToolContext;

const textOf = (result: { content: readonly { text: string }[] }): string =>
  result.content.map((block) => block.text).join('\n');

describe('mneia_handoff_create', () => {
  it('returns the frozen artifact and tells the receiver how to take it', async () => {
    const context = contextWith();

    const result = await handoffCreateTool.run(
      handoffCreateTool.parse({ nextAction: NEXT_ACTION }),
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('# Handoff: payments-migration');
    expect(textOf(result)).toContain('mneia_handoff_receive');
    expect(result.structuredContent).toMatchObject({ status: 'ok', handoffId: HANDOFF_ID });
  });

  it('says an unaddressed handoff is open rather than leaving the recipient blank', async () => {
    const result = await handoffCreateTool.run(
      handoffCreateTool.parse({ nextAction: NEXT_ACTION }),
      contextWith(),
    );

    expect(textOf(result)).toContain('open — anyone in the workspace may pick it up');
  });

  it('rejects an empty next action with the §10.3 standard, not just "required"', () => {
    expect(() => handoffCreateTool.parse({ nextAction: '   ' })).toThrow(
      /continue the migration.*does not/,
    );
  });

  it('rejects a toActor that is not an actor id', () => {
    expect(() => handoffCreateTool.parse({ nextAction: NEXT_ACTION, toActor: 'alex' })).toThrow(
      /toActor must be an actor id/,
    );
  });

  it('says which project is missing when none is supplied and none is bound', async () => {
    const context = { ...contextWith(), defaultProject: null } as ToolContext;

    const result = await handoffCreateTool.run(
      handoffCreateTool.parse({ nextAction: NEXT_ACTION }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'project_not_bound' } });
  });

  it('reports an unknown project as project_not_found rather than a transport failure', async () => {
    const context = contextWith({
      handoff: vi.fn(async () => {
        throw new ApiError('not_found', 'expected project "nope" ...', 404);
      }),
    });

    const result = await handoffCreateTool.run(
      handoffCreateTool.parse({ nextAction: NEXT_ACTION }),
      context,
    );

    expect(result.structuredContent).toMatchObject({ error: { code: 'project_not_found' } });
  });

  it('does not claim the handoff exists when the call failed', async () => {
    const context = contextWith({
      handoff: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });

    const result = await handoffCreateTool.run(
      handoffCreateTool.parse({ nextAction: NEXT_ACTION }),
      context,
    );

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('rather than assuming the handoff exists');
  });
});

describe('mneia_handoff_receive', () => {
  it('marks it received and returns what the receiver was given', async () => {
    const context = contextWith();

    const result = await handoffReceiveTool.run(
      handoffReceiveTool.parse({ id: HANDOFF_ID }),
      context,
    );

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('# Handoff: payments-migration');
    expect(result.structuredContent).toMatchObject({ receivedAt: NOW.toISOString() });
  });

  it('tells the agent the constraints bind it and not to re-propose superseded work', async () => {
    const result = await handoffReceiveTool.run(
      handoffReceiveTool.parse({ id: HANDOFF_ID }),
      contextWith(),
    );

    expect(textOf(result)).toContain('do not re-propose anything under Superseded recently');
  });

  it('distinguishes a second pickup from a transport failure', async () => {
    const context = contextWith({
      receiveHandoff: vi.fn(async () => {
        throw new ApiError('invalid_request', 'expected handoff to be unreceived', 400);
      }),
    });

    const result = await handoffReceiveTool.run(
      handoffReceiveTool.parse({ id: HANDOFF_ID }),
      context,
    );

    expect(result.structuredContent).toMatchObject({ error: { code: 'already_received' } });
  });

  it('distinguishes someone else’s addressed handoff from a missing one', async () => {
    const context = contextWith({
      receiveHandoff: vi.fn(async () => {
        throw new ApiError('forbidden', 'expected handoff to be received by another actor', 403);
      }),
    });

    const result = await handoffReceiveTool.run(
      handoffReceiveTool.parse({ id: HANDOFF_ID }),
      context,
    );

    expect(result.structuredContent).toMatchObject({ error: { code: 'wrong_receiver' } });
  });

  it('refuses to let an agent start on an artifact it was not given', async () => {
    const context = contextWith({
      receiveHandoff: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });

    const result = await handoffReceiveTool.run(
      handoffReceiveTool.parse({ id: HANDOFF_ID }),
      context,
    );

    expect(textOf(result)).toContain('rather than starting work on an artifact you were not given');
  });

  it('rejects an id that is not a handoff id', () => {
    expect(() => handoffReceiveTool.parse({ id: 'latest' })).toThrow(/id must be a handoff id/);
  });
});
