import type { ScopedStore, TelemetryEmitter } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import type { ErasedToolDefinition } from './registry.js';
import {
  DEFERRED_TOOL_MILESTONES,
  findToolDefinition,
  isToolDefinition,
  SHIPPED_TOOL_NAMES,
  ToolRegistrationError,
  ToolRegistry,
} from './registry.js';
import type { ToolContext, ToolDefinition, ToolResult } from './tools/types.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-01T12:00:00.000Z');

function unreachable(method: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${method} must not be called by the registry`));
}

const STORE: ScopedStore = {
  scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
  getActor: unreachable('getActor'),
  getProjectBySlug: unreachable('getProjectBySlug'),
  getProject: unreachable('getProject'),
  createSession: unreachable('createSession'),
  endSession: unreachable('endSession'),
  getContextItem: unreachable('getContextItem'),
  listContextItems: unreachable('listContextItems'),
  searchContextItems: unreachable('searchContextItems'),
  insertContextItem: unreachable('insertContextItem'),
  supersedeContextItem: unreachable('supersedeContextItem'),
  writeCheckpoint: unreachable('writeCheckpoint'),
  getCheckpoint: unreachable('getCheckpoint'),
  listCheckpoints: unreachable('listCheckpoints'),
  createHandoff: unreachable('createHandoff'),
  receiveHandoff: unreachable('receiveHandoff'),
  getHandoff: unreachable('getHandoff'),
  recordConflict: unreachable('recordConflict'),
  listOpenConflicts: unreachable('listOpenConflicts'),
  resolveConflict: unreachable('resolveConflict'),
};

const TELEMETRY: TelemetryEmitter = {
  emit: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

const CONTEXT: ToolContext = { store: STORE, telemetry: TELEMETRY, now: () => NOW };

interface StubOptions {
  readonly parse?: (raw: unknown) => unknown;
  readonly run?: (input: unknown, context: ToolContext) => Promise<ToolResult>;
}

function stubTool(name: string, options: StubOptions = {}): ErasedToolDefinition {
  return {
    name,
    title: `Stub ${name}`,
    description: `Stub definition for ${name}.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    parse: options.parse ?? ((raw) => raw),
    run:
      options.run ??
      ((input) => Promise.resolve({ content: [{ type: 'text', text: JSON.stringify(input) }] })),
  };
}

function allShippedTools(): readonly ErasedToolDefinition[] {
  return SHIPPED_TOOL_NAMES.map((name) => stubTool(name));
}

function textOf(result: ToolResult): string {
  const [block] = result.content;
  if (block === undefined) {
    throw new Error('tool returned no content block');
  }
  return block.text;
}

function errorCodeOf(result: ToolResult): string {
  const structured = result.structuredContent;
  if (structured === undefined) {
    throw new Error('tool returned no structuredContent');
  }
  const { error } = structured;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    throw new Error('tool returned no structured error');
  }
  const { code } = error;
  if (typeof code !== 'string') {
    throw new Error('structured error has no string code');
  }
  return code;
}

describe('ToolRegistry registration', () => {
  it('lists exactly the shipped tool surface, in shipping order', () => {
    const registry = new ToolRegistry(allShippedTools());

    expect(registry.list().map((listing) => listing.name)).toEqual([
      'mneia_rehydrate',
      'mneia_assert',
      'mneia_retire',
      'mneia_checkpoint',
      'mneia_search',
      'mneia_handoff_create',
      'mneia_handoff_receive',
      'mneia_handoff_inbox',
      'mneia_team',
      'mneia_sessions',
      'mneia_review_queue',
      'mneia_review_confirm',
    ]);
    expect(registry.size).toBe(12);
  });

  it('carries the title, description, and input schema through to the listing', () => {
    const registry = new ToolRegistry([stubTool('mneia_rehydrate')]);
    const [listing] = registry.list();

    expect(listing).toEqual({
      name: 'mneia_rehydrate',
      title: 'Stub mneia_rehydrate',
      description: 'Stub definition for mneia_rehydrate.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    });
  });

  it('lists the tools that are present when a later one has not been built yet', () => {
    const registry = new ToolRegistry([stubTool('mneia_search'), stubTool('mneia_rehydrate')]);

    expect(registry.names()).toEqual(['mneia_rehydrate', 'mneia_search']);
    expect(registry.has('mneia_checkpoint')).toBe(false);
  });

  it.each([...DEFERRED_TOOL_MILESTONES.entries()])(
    'refuses to register %s because it ships in %s',
    (name, milestone) => {
      expect(() => new ToolRegistry([stubTool(name)])).toThrow(ToolRegistrationError);
      expect(() => new ToolRegistry([stubTool(name)])).toThrow(new RegExp(`ships in ${milestone}`));
    },
  );

  it('refuses a name that is not a Mneia tool at all', () => {
    expect(() => new ToolRegistry([stubTool('query')])).toThrow(/not a Mneia tool/);
  });

  it('refuses two definitions claiming the same name', () => {
    expect(() => new ToolRegistry([stubTool('mneia_assert'), stubTool('mneia_assert')])).toThrow(
      /registered twice/,
    );
  });
});

describe('ToolRegistry dispatch', () => {
  it('passes parsed input and the context to the tool', async () => {
    let seen: { readonly input: unknown; readonly context: ToolContext } | null = null;
    const registry = new ToolRegistry([
      stubTool('mneia_assert', {
        parse: (raw) => ({ normalised: raw }),
        run: (input, context) => {
          seen = { input, context };
          return Promise.resolve({ content: [{ type: 'text', text: 'written' }] });
        },
      }),
    ]);

    const result = await registry.dispatch('mneia_assert', { kind: 'decision' }, CONTEXT);

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe('written');
    expect(seen).toEqual({ input: { normalised: { kind: 'decision' } }, context: CONTEXT });
  });

  it('refuses an unregistered name without needing a context', () => {
    const registry = new ToolRegistry(allShippedTools());

    expect(registry.refuse('mneia_rehydrate')).toBeNull();

    const refusal = registry.refuse('mneia_conflicts');
    if (refusal === null) {
      throw new Error('expected mneia_conflicts to be refused');
    }
    expect(refusal.isError).toBe(true);
    expect(textOf(refusal)).toContain('M4');
  });

  it('returns a structured error rather than throwing for an unknown tool name', async () => {
    const registry = new ToolRegistry(allShippedTools());

    const result = await registry.dispatch('query', {}, CONTEXT);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('unknown_tool');
    expect(textOf(result)).toContain('mneia_rehydrate');
    expect(textOf(result)).toContain('do not retry');
  });

  it('names the milestone when the agent calls a tool that has not shipped', async () => {
    const registry = new ToolRegistry(allShippedTools());

    const result = await registry.dispatch('mneia_conflicts', {}, CONTEXT);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('tool_not_available');
    expect(textOf(result)).toContain('M4');
  });

  it('says so when an M1 tool exists but this server did not load it', async () => {
    const registry = new ToolRegistry([stubTool('mneia_rehydrate')]);

    const result = await registry.dispatch('mneia_search', {}, CONTEXT);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('tool_not_available');
    expect(textOf(result)).toContain('mneia_rehydrate');
  });

  it('turns a validation throw into an invalid_arguments result', async () => {
    const registry = new ToolRegistry([
      stubTool('mneia_rehydrate', {
        parse: () => {
          throw new Error('mneia_rehydrate received invalid input: task is required.');
        },
      }),
    ]);

    const result = await registry.dispatch('mneia_rehydrate', {}, CONTEXT);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('invalid_arguments');
    expect(textOf(result)).toContain('task is required');
    expect(textOf(result)).toContain('Nothing was read or written');
  });

  it('turns a throwing tool into an isError result instead of propagating', async () => {
    const registry = new ToolRegistry([
      stubTool('mneia_checkpoint', {
        run: () => Promise.reject(new Error('connection terminated unexpectedly')),
      }),
    ]);

    const result = await registry.dispatch('mneia_checkpoint', {}, CONTEXT);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('tool_failed');
    expect(textOf(result)).toContain('connection terminated unexpectedly');
    expect(textOf(result)).toContain('Retry once');
  });

  it('survives a tool that throws a non-Error value', async () => {
    const registry = new ToolRegistry([
      stubTool('mneia_search', {
        run: () => {
          throw 'socket hang up';
        },
      }),
    ]);

    const result = await registry.dispatch('mneia_search', {}, CONTEXT);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('socket hang up');
  });

  it('keeps serving after a tool has failed', async () => {
    let calls = 0;
    const registry = new ToolRegistry([
      stubTool('mneia_search', {
        run: () => {
          calls += 1;
          if (calls === 1) {
            return Promise.reject(new Error('transient'));
          }
          return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
        },
      }),
    ]);

    expect((await registry.dispatch('mneia_search', {}, CONTEXT)).isError).toBe(true);
    expect(textOf(await registry.dispatch('mneia_search', {}, CONTEXT))).toBe('ok');
  });
});

describe('findToolDefinition', () => {
  it('finds the definition regardless of the export name it was given', () => {
    const tool = stubTool('mneia_search');
    const found = findToolDefinition({ DEFAULT_LIMIT: 20, somethingElse: tool }, 'mneia_search');

    expect(found).toBe(tool);
  });

  it('returns null when the module exports no matching definition', () => {
    expect(findToolDefinition({ searchTool: stubTool('mneia_assert') }, 'mneia_search')).toBeNull();
    expect(findToolDefinition(undefined, 'mneia_search')).toBeNull();
    expect(findToolDefinition('not a module', 'mneia_search')).toBeNull();
  });

  it('rejects an export that only looks like a tool definition', () => {
    const halfBuilt = {
      name: 'mneia_search',
      title: 'Search',
      description: 'Search project memory.',
      inputSchema: { type: 'object' },
    };

    expect(isToolDefinition(halfBuilt, 'mneia_search')).toBe(false);
    expect(findToolDefinition({ halfBuilt }, 'mneia_search')).toBeNull();
  });

  it('accepts a real definition shape', () => {
    const real: ToolDefinition<{ readonly q: string }> = {
      name: 'mneia_search',
      title: 'Search',
      description: 'Search project memory.',
      inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
      parse: (raw) => ({ q: String(raw) }),
      run: (input) => Promise.resolve({ content: [{ type: 'text', text: input.q }] }),
    };

    expect(isToolDefinition(real, 'mneia_search')).toBe(true);
  });
});
