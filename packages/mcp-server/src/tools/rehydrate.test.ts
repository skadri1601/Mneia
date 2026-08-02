import type {
  ContextItem,
  ContextItemFilter,
  ContextItemSearch,
  Project,
  ScopedStore,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TOKEN_BUDGET, rehydrateTool } from './rehydrate.js';
import type { ToolContext, ToolResult } from './types.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-01T12:00:00.000Z');
const ASSERTED_AT = new Date('2026-07-20T09:00:00.000Z');

const PROJECT: Project = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  teamId: null,
  slug: 'payments-migration',
  repoUrl: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

function contextItem(
  overrides: Partial<ContextItem> & { readonly id: Uuid; readonly title: string },
): ContextItem {
  return {
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    kind: 'fact',
    body: null,
    status: 'active',
    assertedBy: ACTOR_ID,
    assertedAt: ASSERTED_AT,
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.8,
    humanConfirmed: false,
    loadBearing: false,
    lastVerifiedAt: null,
    decayAfter: null,
    validFrom: ASSERTED_AT,
    validTo: null,
    supersedesId: null,
    supersededById: null,
    accessScope: 'project',
    embedding: null,
    ...overrides,
  };
}

const LOAD_BEARING_CONSTRAINT = contextItem({
  id: '44444444-4444-4444-8444-444444444444',
  title: 'No downtime window; the cutover must be online',
  kind: 'constraint',
  body: 'BODY-CONSTRAINT-must-not-leak',
  humanConfirmed: true,
  loadBearing: true,
  confidence: 1,
});

const FACTS: readonly ContextItem[] = [
  contextItem({
    id: '55555555-5555-4555-8555-555555555555',
    title: 'Ledger writes are cut over and green in staging',
    body: 'BODY-FACT-ONE-must-not-leak',
  }),
  contextItem({
    id: '66666666-6666-4666-8666-666666666666',
    title: 'Rollback flag payments.v2_reads is live',
    body: 'BODY-FACT-TWO-must-not-leak',
  }),
];

interface StoreCall {
  readonly method: string;
  readonly argument: unknown;
}

interface FakeStoreOptions {
  readonly project?: Project | null;
  readonly candidates?: readonly ContextItem[];
  readonly loadBearing?: readonly ContextItem[];
  readonly failOn?: string;
}

interface FakeStore {
  readonly store: ScopedStore;
  readonly calls: StoreCall[];
}

function unsupported(method: string): never {
  throw new Error(`ScopedStore.${method} is not used by mneia_rehydrate`);
}

function createStore(options: FakeStoreOptions = {}): FakeStore {
  const calls: StoreCall[] = [];
  const project = options.project === undefined ? PROJECT : options.project;
  const candidates = options.candidates ?? FACTS;
  const loadBearing = options.loadBearing ?? [LOAD_BEARING_CONSTRAINT];

  function record(method: string, argument: unknown): void {
    calls.push({ method, argument });
    if (options.failOn === method) {
      throw new Error('connect ECONNREFUSED 10.0.0.4:5432');
    }
  }

  const store: ScopedStore = {
    scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },

    async getProjectBySlug(slug: string): Promise<Project | null> {
      record('getProjectBySlug', slug);
      return project;
    },
    async getProject(id: Uuid): Promise<Project | null> {
      record('getProject', id);
      return project;
    },
    async searchContextItems(search: ContextItemSearch): Promise<readonly ContextItem[]> {
      record('searchContextItems', search);
      return search.limit === undefined ? candidates : candidates.slice(0, search.limit);
    },
    async listContextItems(filter: ContextItemFilter): Promise<readonly ContextItem[]> {
      record('listContextItems', filter);
      return filter.loadBearing === true ? loadBearing : candidates;
    },

    getActor: () => unsupported('getActor'),
    createSession: () => unsupported('createSession'),
    endSession: () => unsupported('endSession'),
    getContextItem: () => unsupported('getContextItem'),
    insertContextItem: () => unsupported('insertContextItem'),
    supersedeContextItem: () => unsupported('supersedeContextItem'),
    writeCheckpoint: () => unsupported('writeCheckpoint'),
    getCheckpoint: () => unsupported('getCheckpoint'),
    listCheckpoints: () => unsupported('listCheckpoints'),
    createHandoff: () => unsupported('createHandoff'),
    receiveHandoff: () => unsupported('receiveHandoff'),
    getHandoff: () => unsupported('getHandoff'),
    recordConflict: () => unsupported('recordConflict'),
    listOpenConflicts: () => unsupported('listOpenConflicts'),
    resolveConflict: () => unsupported('resolveConflict'),
  };

  return { store, calls };
}

interface FakeTelemetry {
  readonly emitter: TelemetryEmitter;
  readonly events: TelemetryEvent[];
}

function createTelemetry(options: { readonly throwOnEmit?: boolean } = {}): FakeTelemetry {
  const events: TelemetryEvent[] = [];
  const emitter: TelemetryEmitter = {
    async emit(event: TelemetryEvent): Promise<void> {
      events.push(event);
      if (options.throwOnEmit === true) {
        throw new Error('telemetry sink unreachable');
      }
    },
    async flush(): Promise<void> {},
    async close(): Promise<void> {},
  };
  return { emitter, events };
}

function createContext(store: ScopedStore, telemetry: TelemetryEmitter): ToolContext {
  return { store, telemetry, now: () => NOW };
}

function textOf(result: ToolResult): string {
  const [block] = result.content;
  if (block === undefined) {
    throw new Error('tool returned no content block');
  }
  return block.text;
}

function structuredOf(result: ToolResult): Record<string, unknown> {
  const { structuredContent } = result;
  if (structuredContent === undefined) {
    throw new Error('tool returned no structuredContent');
  }
  return structuredContent;
}

function errorCodeOf(result: ToolResult): string {
  const { error } = structuredOf(result);
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    throw new Error('tool returned no structured error');
  }
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : '';
}

function callArgument(calls: readonly StoreCall[], method: string): Record<string, unknown> {
  const call = calls.find((candidate) => candidate.method === method);
  if (call === undefined) {
    throw new Error(`expected the tool to call ScopedStore.${method}`);
  }
  return call.argument as Record<string, unknown>;
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the call to throw');
}

async function runTool(
  raw: unknown,
  fake: FakeStore,
  telemetry: FakeTelemetry,
): Promise<ToolResult> {
  return rehydrateTool.run(rehydrateTool.parse(raw), createContext(fake.store, telemetry.emitter));
}

describe('mneia_rehydrate surface', () => {
  it('is named and described so an agent can pick it without reading the code', () => {
    expect(rehydrateTool.name).toBe('mneia_rehydrate');
    expect(rehydrateTool.description).toContain('constraints');
    expect(rehydrateTool.inputSchema).toMatchObject({
      type: 'object',
      required: ['task'],
    });
  });
});

describe('mneia_rehydrate input validation', () => {
  it('accepts a task alone and applies the default token budget', () => {
    expect(rehydrateTool.parse({ task: 'wire the retry path' })).toEqual({
      task: 'wire the retry path',
      tokenBudget: DEFAULT_TOKEN_BUDGET,
    });
  });

  it('accepts a full input and trims surrounding whitespace', () => {
    expect(
      rehydrateTool.parse({
        task: '  wire the retry path  ',
        project: '  payments-migration  ',
        tokenBudget: 8000,
      }),
    ).toEqual({
      task: 'wire the retry path',
      project: 'payments-migration',
      tokenBudget: 8000,
    });
  });

  it('rejects a missing task and names the fix', () => {
    const message = messageOf(() => rehydrateTool.parse({}));
    expect(message).toContain('mneia_rehydrate received invalid input');
    expect(message).toContain('task is required');
    expect(message).toContain('call mneia_rehydrate again');
  });

  it('rejects an empty task with a concrete example', () => {
    const message = messageOf(() => rehydrateTool.parse({ task: '   ' }));
    expect(message).toContain('task must not be empty');
    expect(message).toContain('for example');
  });

  it('rejects a non-string task and says what it received', () => {
    const message = messageOf(() => rehydrateTool.parse({ task: 42 }));
    expect(message).toContain('task must be a string');
    expect(message).toContain('received number');
  });

  it('rejects an over-long task rather than truncating it', () => {
    const message = messageOf(() => rehydrateTool.parse({ task: 'x'.repeat(4001) }));
    expect(message).toContain('task must be at most');
  });

  it('rejects an empty project string and offers omitting the argument', () => {
    const message = messageOf(() => rehydrateTool.parse({ task: 'ship it', project: '  ' }));
    expect(message).toContain('project must not be empty');
    expect(message).toContain('omit the argument');
  });

  it('rejects a fractional token budget', () => {
    const message = messageOf(() => rehydrateTool.parse({ task: 'ship it', tokenBudget: 12.5 }));
    expect(message).toContain('tokenBudget must be a whole number');
  });

  it('rejects a token budget too small to hold the load-bearing constraints', () => {
    const message = messageOf(() => rehydrateTool.parse({ task: 'ship it', tokenBudget: 10 }));
    expect(message).toContain('tokenBudget must be at least');
    expect(message).toContain('load-bearing');
  });

  it('rejects a token budget larger than a minimal slice', () => {
    const message = messageOf(() => rehydrateTool.parse({ task: 'ship it', tokenBudget: 200_000 }));
    expect(message).toContain('tokenBudget must be at most');
  });

  it('rejects a non-object payload', () => {
    const message = messageOf(() => rehydrateTool.parse('just rehydrate it'));
    expect(message).toContain('expected object');
  });
});

describe('mneia_rehydrate pipeline', () => {
  it('returns rendered markdown and structured content a client can correlate', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool({ task: 'wire the retry path', project: 'payments-migration' }, fake, telemetry);

    expect(result.isError).toBeUndefined();
    expect(textOf(result).length).toBeGreaterThan(0);

    const structured = structuredOf(result);
    expect(structured.projectId).toBe(PROJECT_ID);
    expect(typeof structured.sliceId).toBe('string');
    expect(Array.isArray(structured.itemIds)).toBe(true);
    expect(structured.tokenBudget).toBe(DEFAULT_TOKEN_BUDGET);
    expect(typeof structured.tokensUsed).toBe('number');
  });

  it('reaches the store once per query and resolves the project by slug', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: 'wire the retry path', project: 'payments-migration' }, fake, telemetry);

    expect(fake.calls.map((call) => call.method)).toEqual([
      'getProjectBySlug',
      'searchContextItems',
      'listContextItems',
    ]);
  });

  it('resolves a project id without a slug lookup', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: 'wire the retry path', project: PROJECT_ID }, fake, telemetry);

    expect(fake.calls[0]?.method).toBe('getProject');
  });

  it('bounds the candidate query but never the load-bearing query', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: 'wire the retry path', project: 'payments-migration' }, fake, telemetry);

    const search = callArgument(fake.calls, 'searchContextItems');
    expect(typeof search.limit).toBe('number');
    expect(search.limit as number).toBeGreaterThan(0);
    expect(search.statuses).toEqual(['active']);
    expect(search.asOf).toEqual(NOW);

    const list = callArgument(fake.calls, 'listContextItems');
    expect(list.loadBearing).toBe(true);
    expect(list.limit).toBeUndefined();
    expect(list.statuses).toEqual(['active']);
  });

  it('keeps a load-bearing active constraint the candidate limit excluded', async () => {
    const fake = createStore({ candidates: FACTS, loadBearing: [LOAD_BEARING_CONSTRAINT] });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: 'wire the retry path', project: 'payments-migration', tokenBudget: 500 },
      fake,
      telemetry,
    );

    const search = callArgument(fake.calls, 'searchContextItems');
    expect(search.limit).not.toBeUndefined();

    const itemIds = structuredOf(result).itemIds;
    expect(itemIds).toContain(LOAD_BEARING_CONSTRAINT.id);
    expect(textOf(result)).toContain(LOAD_BEARING_CONSTRAINT.title);
  });

  it('does not duplicate an item returned by both queries', async () => {
    const fake = createStore({
      candidates: [LOAD_BEARING_CONSTRAINT, ...FACTS],
      loadBearing: [LOAD_BEARING_CONSTRAINT],
    });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: 'wire the retry path', project: 'payments-migration' },
      fake,
      telemetry,
    );

    const itemIds = structuredOf(result).itemIds as readonly string[];
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });
});

describe('mneia_rehydrate telemetry', () => {
  it('emits rehydration.slice_shown exactly once with the included item ids', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: 'wire the retry path', project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(telemetry.events).toHaveLength(1);
    const [event] = telemetry.events;
    if (event === undefined || event.name !== 'rehydration.slice_shown') {
      throw new Error('expected a rehydration.slice_shown event');
    }

    const structured = structuredOf(result);
    expect(event.sliceId).toBe(structured.sliceId);
    expect(event.itemIds).toEqual(structured.itemIds);
    expect(event.projectId).toBe(PROJECT_ID);
    expect(event.workspaceId).toBe(WORKSPACE_ID);
    expect(event.actorId).toBe(ACTOR_ID);
    expect(event.occurredAt).toEqual(NOW);
    expect(event.tokenBudget).toBe(DEFAULT_TOKEN_BUDGET);
    expect(event.tokensUsed).toBe(structured.tokensUsed);
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('carries no item body and no field beyond the §17 shape', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: 'wire the retry path', project: 'payments-migration' }, fake, telemetry);

    const [event] = telemetry.events;
    if (event === undefined) {
      throw new Error('expected a rehydration.slice_shown event');
    }

    const serialised = JSON.stringify(event);
    for (const item of [LOAD_BEARING_CONSTRAINT, ...FACTS]) {
      const { body } = item;
      if (body !== null) {
        expect(serialised).not.toContain(body);
      }
      expect(serialised).not.toContain(item.title);
    }
    expect(serialised).not.toContain('wire the retry path');

    expect(Object.keys(event).sort()).toEqual(
      [
        'actorId',
        'durationMs',
        'itemIds',
        'name',
        'occurredAt',
        'projectId',
        'sliceId',
        'tokenBudget',
        'tokensUsed',
        'workspaceId',
      ].sort(),
    );
  });

  it('still returns the slice when the telemetry sink throws', async () => {
    const fake = createStore();
    const telemetry = createTelemetry({ throwOnEmit: true });
    const result = await runTool(
      { task: 'wire the retry path', project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(result.isError).toBeUndefined();
    expect(textOf(result).length).toBeGreaterThan(0);
    expect(telemetry.events).toHaveLength(1);
  });
});

describe('mneia_rehydrate errors', () => {
  it('distinguishes an unbound project and names both fixes', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool({ task: 'wire the retry path' }, fake, telemetry);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('project_not_bound');
    expect(textOf(result)).toContain('project');
    expect(textOf(result)).toContain('mneia init');
    expect(fake.calls).toHaveLength(0);
    expect(telemetry.events).toHaveLength(0);
  });

  it('distinguishes a project that does not exist', async () => {
    const fake = createStore({ project: null });
    const telemetry = createTelemetry();
    const result = await runTool({ task: 'wire the retry path', project: 'nope' }, fake, telemetry);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('project_not_found');
    expect(textOf(result)).toContain('"nope"');
    expect(telemetry.events).toHaveLength(0);
  });

  it('distinguishes an unreachable store from a bad argument', async () => {
    const fake = createStore({ failOn: 'searchContextItems' });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: 'wire the retry path', project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('searchContextItems');
    expect(textOf(result)).toContain('not a bad argument');
    expect(telemetry.events).toHaveLength(0);
  });

  it('reports an unreachable store during project resolution too', async () => {
    const fake = createStore({ failOn: 'getProjectBySlug' });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: 'wire the retry path', project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('getProjectBySlug');
  });
});
