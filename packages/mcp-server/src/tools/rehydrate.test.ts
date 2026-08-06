import { createToolContextFixture } from './context-fixture.js';
import type {
  ContextItem,
  ContextItemFilter,
  ContextItemSearch,
  ItemKind,
  ItemStatus,
  Project,
  ScopedStore,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOKEN_BUDGET,
  MANDATORY_ITEM_LIMIT,
  MAX_CANDIDATES,
  MAX_TOKEN_BUDGET,
  RECENT_SUPERSEDED_LIMIT,
  rehydrateTool,
} from './rehydrate.js';
import type { ToolContext, ToolResult } from './types.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-08-01T12:00:00.000Z');
const ASSERTED_AT = new Date('2026-07-20T09:00:00.000Z');
const SUPERSEDED_AT = new Date('2026-07-28T09:00:00.000Z');

const STORE_DEFAULT_LIMIT = 200;
const STORE_MAX_LIMIT = 1000;

const ORDINARY_TASK = 'wire the retry path in charges/worker.rb to the new idempotency key';

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

const SUPERSEDED_DECISION = contextItem({
  id: '77777777-7777-4777-8777-777777777777',
  title: 'Redis-based cutover lock',
  body: 'BODY-SUPERSEDED-DECISION-must-not-leak',
  kind: 'decision',
  status: 'superseded',
  validTo: SUPERSEDED_AT,
  supersededById: '99999999-9999-4999-8999-999999999999',
});

const SUPERSEDED_LOAD_BEARING_CONSTRAINT = contextItem({
  id: '88888888-8888-4888-8888-888888888888',
  title: 'Seven-day dual-read window',
  body: 'BODY-SUPERSEDED-CONSTRAINT-must-not-leak',
  kind: 'constraint',
  status: 'superseded',
  loadBearing: true,
  humanConfirmed: true,
  validTo: SUPERSEDED_AT,
  supersededById: '99999999-9999-4999-8999-999999999999',
});

const SUPERSEDED_ITEMS: readonly ContextItem[] = [
  SUPERSEDED_DECISION,
  SUPERSEDED_LOAD_BEARING_CONSTRAINT,
];

const ALL_FIXTURES: readonly ContextItem[] = [
  LOAD_BEARING_CONSTRAINT,
  ...FACTS,
  ...SUPERSEDED_ITEMS,
];

function loadBearingConstraints(count: number): readonly ContextItem[] {
  return Array.from({ length: count }, (_unused, index) =>
    contextItem({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      title: `Load-bearing constraint ${index}`,
      kind: 'constraint',
      loadBearing: true,
      humanConfirmed: true,
      confidence: 1,
    }),
  );
}

interface StoreCall {
  readonly method: string;
  readonly argument: unknown;
}

interface FakeStoreOptions {
  readonly project?: Project | null;
  readonly candidates?: readonly ContextItem[];
  readonly mandatory?: readonly ContextItem[];
  readonly superseded?: readonly ContextItem[];
  readonly failOn?: string;
}

interface FakeStore {
  readonly store: ScopedStore;
  readonly calls: StoreCall[];
}

function unsupported(method: string): never {
  throw new Error(`ScopedStore.${method} is not used by mneia_rehydrate`);
}

function matchesKinds(item: ContextItem, kinds: readonly ItemKind[] | undefined): boolean {
  return kinds === undefined || kinds.includes(item.kind);
}

function matchesStatuses(item: ContextItem, statuses: readonly ItemStatus[] | undefined): boolean {
  return statuses === undefined || statuses.includes(item.status);
}

function matchesLoadBearing(item: ContextItem, loadBearing: boolean | undefined): boolean {
  return loadBearing === undefined || item.loadBearing === loadBearing;
}

function withinValidity(item: ContextItem, asOf: Date | undefined): boolean {
  if (asOf === undefined) {
    return true;
  }
  if (item.validFrom.getTime() > asOf.getTime()) {
    return false;
  }
  return item.validTo === null || item.validTo.getTime() > asOf.getTime();
}

function matchesText(item: ContextItem, text: string | undefined): boolean {
  if (text === undefined || text.trim() === '') {
    return true;
  }
  const needle = text.trim().toLowerCase();
  return (
    item.title.toLowerCase().includes(needle) || (item.body ?? '').toLowerCase().includes(needle)
  );
}

function applyLimit(
  items: readonly ContextItem[],
  limit: number | undefined,
): readonly ContextItem[] {
  if (limit === undefined) {
    return items.slice(0, STORE_DEFAULT_LIMIT);
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > STORE_MAX_LIMIT) {
    throw new Error(
      `expected filter.limit to be an integer between 1 and ${STORE_MAX_LIMIT}; received ${limit}`,
    );
  }
  return items.slice(0, limit);
}

function select(pool: readonly ContextItem[], search: ContextItemSearch): readonly ContextItem[] {
  const matched = pool.filter(
    (item) =>
      matchesKinds(item, search.kinds) &&
      matchesStatuses(item, search.statuses) &&
      matchesLoadBearing(item, search.loadBearing) &&
      withinValidity(item, search.asOf) &&
      matchesText(item, search.text),
  );
  return applyLimit(matched, search.limit);
}

function createStore(options: FakeStoreOptions = {}): FakeStore {
  const calls: StoreCall[] = [];
  const project = options.project === undefined ? PROJECT : options.project;
  const candidates = options.candidates ?? FACTS;
  const mandatory = options.mandatory ?? [LOAD_BEARING_CONSTRAINT];
  const superseded = options.superseded ?? SUPERSEDED_ITEMS;

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
      return select(candidates, search);
    },
    async listContextItems(filter: ContextItemFilter): Promise<readonly ContextItem[]> {
      record('listContextItems', filter);
      if (filter.loadBearing === true) {
        return select(mandatory, filter);
      }
      if (filter.statuses?.includes('superseded') === true) {
        return select(superseded, filter);
      }
      return select(candidates, filter);
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
  return createToolContextFixture(store, telemetry, { now: NOW });
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

function idsOf(result: ToolResult, field: string): readonly string[] {
  const value = structuredOf(result)[field];
  if (!Array.isArray(value)) {
    throw new Error(`expected structuredContent.${field} to be an array of item ids`);
  }
  return value as readonly string[];
}

function errorCodeOf(result: ToolResult): string {
  const { error } = structuredOf(result);
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    throw new Error('tool returned no structured error');
  }
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : '';
}

function callArguments(
  calls: readonly StoreCall[],
  method: string,
): readonly Record<string, unknown>[] {
  return calls
    .filter((candidate) => candidate.method === method)
    .map((candidate) => candidate.argument as Record<string, unknown>);
}

function callArgument(
  calls: readonly StoreCall[],
  method: string,
  occurrence = 0,
): Record<string, unknown> {
  const argument = callArguments(calls, method)[occurrence];
  if (argument === undefined) {
    throw new Error(`expected the tool to call ScopedStore.${method} at least ${occurrence + 1}x`);
  }
  return argument;
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
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(result.isError).toBeUndefined();
    expect(textOf(result).length).toBeGreaterThan(0);

    const structured = structuredOf(result);
    expect(structured.projectId).toBe(PROJECT_ID);
    expect(typeof structured.sliceId).toBe('string');
    expect(Array.isArray(structured.itemIds)).toBe(true);
    expect(Array.isArray(structured.mandatoryItemIds)).toBe(true);
    expect(structured.tokenBudget).toBe(DEFAULT_TOKEN_BUDGET);
    expect(typeof structured.tokensUsed).toBe('number');
  });

  it('reaches the store once per query and resolves the project by slug', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: ORDINARY_TASK, project: 'payments-migration' }, fake, telemetry);

    expect(fake.calls.map((call) => call.method)).toEqual([
      'getProjectBySlug',
      'searchContextItems',
      'listContextItems',
      'listContextItems',
    ]);
  });

  it('resolves a project id without a slug lookup', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: ORDINARY_TASK, project: PROJECT_ID }, fake, telemetry);

    expect(fake.calls[0]?.method).toBe('getProject');
  });

  it('does not duplicate an item returned by more than one query', async () => {
    const fake = createStore({
      candidates: [LOAD_BEARING_CONSTRAINT, ...FACTS],
      mandatory: [LOAD_BEARING_CONSTRAINT],
    });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    const itemIds = idsOf(result, 'itemIds');
    expect(new Set(itemIds).size).toBe(itemIds.length);
  });
});

describe('mneia_rehydrate candidate retrieval', () => {
  it('retrieves a candidate pool for an ordinary task without an exact-phrase filter', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    const search = callArgument(fake.calls, 'searchContextItems');
    expect(search.text).toBeUndefined();

    const itemIds = idsOf(result, 'itemIds');
    for (const fact of FACTS) {
      expect(itemIds).toContain(fact.id);
    }
  });

  it('bounds the candidate pool so an unconditional call stays inside the latency budget', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration', tokenBudget: MAX_TOKEN_BUDGET },
      fake,
      telemetry,
    );

    const search = callArgument(fake.calls, 'searchContextItems');
    expect(search.limit).toBe(MAX_CANDIDATES);
    expect(search.statuses).toEqual(['active']);
    expect(search.asOf).toEqual(NOW);
  });

  it('scales the candidate pool with the token budget', async () => {
    const small = createStore();
    const large = createStore();
    const telemetry = createTelemetry();

    await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration', tokenBudget: 500 },
      small,
      telemetry,
    );
    await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration', tokenBudget: 16_000 },
      large,
      telemetry,
    );

    const smallLimit = callArgument(small.calls, 'searchContextItems').limit;
    const largeLimit = callArgument(large.calls, 'searchContextItems').limit;
    expect(typeof smallLimit).toBe('number');
    expect(largeLimit as number).toBeGreaterThan(smallLimit as number);
    expect(largeLimit as number).toBeLessThanOrEqual(MAX_CANDIDATES);
  });
});

describe('mneia_rehydrate load-bearing constraints', () => {
  it('asks for exactly the constraints the packer treats as mandatory', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: ORDINARY_TASK, project: 'payments-migration' }, fake, telemetry);

    const list = callArgument(fake.calls, 'listContextItems');
    expect(list.kinds).toEqual(['constraint']);
    expect(list.statuses).toEqual(['active']);
    expect(list.loadBearing).toBe(true);
    expect(list.asOf).toEqual(NOW);
    expect(list.limit).toBe(MANDATORY_ITEM_LIMIT);
    expect(list.text).toBeUndefined();
  });

  it('carries every load-bearing constraint past the store default limit to the packer', async () => {
    const constraints = loadBearingConstraints(STORE_DEFAULT_LIMIT + 50);
    const fake = createStore({ mandatory: constraints });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    const mandatoryItemIds = idsOf(result, 'mandatoryItemIds');
    expect(mandatoryItemIds).toHaveLength(constraints.length);

    const included = new Set(idsOf(result, 'itemIds'));
    const missing = constraints.filter((item) => !included.has(item.id)).map((item) => item.id);
    expect(missing).toEqual([]);
  });

  it('keeps a load-bearing constraint the candidate limit excluded, at the smallest budget', async () => {
    const fake = createStore({ candidates: FACTS, mandatory: [LOAD_BEARING_CONSTRAINT] });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration', tokenBudget: 500 },
      fake,
      telemetry,
    );

    const search = callArgument(fake.calls, 'searchContextItems');
    expect(search.limit).not.toBeUndefined();

    expect(idsOf(result, 'itemIds')).toContain(LOAD_BEARING_CONSTRAINT.id);
    expect(textOf(result)).toContain(LOAD_BEARING_CONSTRAINT.title);
  });
});

describe('mneia_rehydrate superseded items', () => {
  it('reads a small window of recently superseded decisions and constraints', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ task: ORDINARY_TASK, project: 'payments-migration' }, fake, telemetry);

    const list = callArgument(fake.calls, 'listContextItems', 1);
    expect(list.statuses).toEqual(['superseded']);
    expect(list.kinds).toEqual(['decision', 'constraint']);
    expect(list.limit).toBe(RECENT_SUPERSEDED_LIMIT);
    expect(RECENT_SUPERSEDED_LIMIT).toBeLessThanOrEqual(MAX_CANDIDATES / 10);
    expect(list.loadBearing).toBeUndefined();
    expect(list.asOf).toBeUndefined();
  });

  it('renders superseded items under the do-not-re-propose heading', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    const itemIds = idsOf(result, 'itemIds');
    for (const item of SUPERSEDED_ITEMS) {
      expect(itemIds).toContain(item.id);
    }
    expect(textOf(result)).toContain('Superseded recently (do not re-propose)');
    expect(textOf(result)).toContain(SUPERSEDED_DECISION.title);
  });

  it('never makes a superseded item mandatory, even a load-bearing constraint', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    const mandatoryItemIds = idsOf(result, 'mandatoryItemIds');
    expect(mandatoryItemIds).toEqual([LOAD_BEARING_CONSTRAINT.id]);
    for (const item of SUPERSEDED_ITEMS) {
      expect(mandatoryItemIds).not.toContain(item.id);
    }
  });

  it('does not crowd the live slice out with superseded items', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    const itemIds = idsOf(result, 'itemIds');
    const supersededIds = new Set(SUPERSEDED_ITEMS.map((item) => item.id));
    const live = itemIds.filter((id) => !supersededIds.has(id));
    expect(live.length).toBeGreaterThanOrEqual(itemIds.length - RECENT_SUPERSEDED_LIMIT);
  });
});

describe('mneia_rehydrate telemetry', () => {
  it('emits rehydration.slice_shown exactly once with the included item ids', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
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
    await runTool({ task: ORDINARY_TASK, project: 'payments-migration' }, fake, telemetry);

    const [event] = telemetry.events;
    if (event === undefined) {
      throw new Error('expected a rehydration.slice_shown event');
    }

    const serialised = JSON.stringify(event);
    for (const item of ALL_FIXTURES) {
      const { body } = item;
      if (body !== null) {
        expect(serialised).not.toContain(body);
      }
      expect(serialised).not.toContain(item.title);
    }
    expect(serialised).not.toContain(ORDINARY_TASK);

    expect(Object.keys(event).sort()).toEqual(
      [
        'actorId',
        'durationMs',
        'itemIds',
        'name',
        'occurredAt',
        'projectId',
        'sessionId',
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
      { task: ORDINARY_TASK, project: 'payments-migration' },
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
    const result = await runTool({ task: ORDINARY_TASK }, fake, telemetry);

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
    const result = await runTool({ task: ORDINARY_TASK, project: 'nope' }, fake, telemetry);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('project_not_found');
    expect(textOf(result)).toContain('"nope"');
    expect(telemetry.events).toHaveLength(0);
  });

  it('distinguishes an unreachable store from a bad argument', async () => {
    const fake = createStore({ failOn: 'searchContextItems' });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('searchContextItems');
    expect(textOf(result)).toContain('not a bad argument');
    expect(telemetry.events).toHaveLength(0);
  });

  it('names which read failed when the store drops mid-retrieval', async () => {
    const fake = createStore({ failOn: 'listContextItems' });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('listContextItems');
    expect(textOf(result)).toContain('load-bearing constraints');
  });

  it('reports an unreachable store during project resolution too', async () => {
    const fake = createStore({ failOn: 'getProjectBySlug' });
    const telemetry = createTelemetry();
    const result = await runTool(
      { task: ORDINARY_TASK, project: 'payments-migration' },
      fake,
      telemetry,
    );

    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('getProjectBySlug');
  });
});
