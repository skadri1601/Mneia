import { createToolContextFixture } from './context-fixture.js';
import type {
  ContextItem,
  ContextItemSearch,
  MemoryTelemetrySink,
  Project,
  ScopedStore,
  TelemetryEmitter,
  Uuid,
} from '@mneia/core';
import { createMemorySink, createTelemetryEmitter } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { createNoopReviewQueue } from '../review-queue.js';
import { createSliceLog } from '../slices.js';
import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, searchTool } from './search.js';
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
    embeddingModel: null,
    ...overrides,
  };
}

const CONSTRAINT = contextItem({
  id: '44444444-4444-4444-8444-444444444444',
  title: 'No downtime window; the cutover must be online',
  kind: 'constraint',
  body: 'The finance close runs nightly, so a maintenance window is not available in Q3.',
  humanConfirmed: true,
  loadBearing: true,
  confidence: 1,
  sourceRef: 'https://example.invalid/pr/412',
});

const SUPERSEDED_DECISION = contextItem({
  id: '55555555-5555-4555-8555-555555555555',
  title: 'Read from the shadow table in the worker',
  kind: 'decision',
  status: 'superseded',
  supersededById: '66666666-6666-4666-8666-666666666666',
});

const MATCHES: readonly ContextItem[] = [CONSTRAINT, SUPERSEDED_DECISION];

interface StoreCall {
  readonly method: string;
  readonly argument: unknown;
}

interface FakeStoreOptions {
  readonly project?: Project | null;
  readonly matches?: readonly ContextItem[];
  readonly failOn?: string;
}

interface FakeStore {
  readonly store: ScopedStore;
  readonly calls: StoreCall[];
}

function unsupported(method: string): never {
  throw new Error(`ScopedStore.${method} is not used by mneia_search`);
}

function createStore(options: FakeStoreOptions = {}): FakeStore {
  const calls: StoreCall[] = [];
  const project = options.project === undefined ? PROJECT : options.project;
  const matches = options.matches ?? MATCHES;

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
      return search.limit === undefined ? matches : matches.slice(0, search.limit);
    },

    getActor: () => unsupported('getActor'),
    createSession: () => unsupported('createSession'),
    endSession: () => unsupported('endSession'),
    getContextItem: () => unsupported('getContextItem'),
    listContextItems: () => unsupported('listContextItems'),
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
  readonly sink: MemoryTelemetrySink;
}

function createTelemetry(): FakeTelemetry {
  const sink = createMemorySink();
  const emitter = createTelemetryEmitter({
    sinks: [sink],
    enabled: true,
    onError: (error) => {
      throw error;
    },
  });
  return { emitter, sink };
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

function errorCodeOf(result: ToolResult): string {
  const { error } = structuredOf(result);
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    throw new Error('tool returned no structured error');
  }
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : '';
}

function itemsOf(result: ToolResult): readonly Record<string, unknown>[] {
  const { items } = structuredOf(result);
  if (!Array.isArray(items)) {
    throw new Error('tool returned no items');
  }
  return items as readonly Record<string, unknown>[];
}

function searchArgumentOf(fake: FakeStore): ContextItemSearch {
  const call = fake.calls.find((candidate) => candidate.method === 'searchContextItems');
  if (call === undefined) {
    throw new Error('expected the tool to call ScopedStore.searchContextItems');
  }
  return call.argument as ContextItemSearch;
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
  return searchTool.run(searchTool.parse(raw), createContext(fake.store, telemetry.emitter));
}

describe('mneia_search surface', () => {
  it('tells an agent when to reach for it instead of rehydrate', () => {
    expect(searchTool.name).toBe('mneia_search');
    expect(searchTool.description).toContain('mneia_rehydrate');
    expect(searchTool.description).toContain('not a ranked slice');
  });

  it('requires nothing but still advertises every filter', () => {
    const schema = searchTool.inputSchema as {
      required?: readonly string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toBeUndefined();
    expect(Object.keys(schema.properties).sort()).toEqual([
      'kinds',
      'limit',
      'loadBearing',
      'project',
      'statuses',
      'text',
    ]);
  });
});

describe('mneia_search input validation', () => {
  it('defaults to active items and a small limit', () => {
    expect(searchTool.parse({ project: 'payments-migration' })).toEqual({
      project: 'payments-migration',
      statuses: ['active'],
      limit: DEFAULT_SEARCH_LIMIT,
    });
  });

  it('trims the project and the text query', () => {
    expect(
      searchTool.parse({ project: '  payments-migration  ', text: '  idempotency key  ' }),
    ).toEqual({
      project: 'payments-migration',
      text: 'idempotency key',
      statuses: ['active'],
      limit: DEFAULT_SEARCH_LIMIT,
    });
  });

  it('names the allowed kinds when one is wrong', () => {
    const message = messageOf(() => searchTool.parse({ project: 'p', kinds: ['note'] }));
    expect(message).toContain('mneia_search rejected the input [invalid_input]');
    expect(message).toContain('kinds must contain only');
    expect(message).toContain('artifact_ref');
  });

  it('names the allowed statuses when one is wrong', () => {
    const message = messageOf(() => searchTool.parse({ project: 'p', statuses: ['stale'] }));
    expect(message).toContain('statuses must contain only');
    expect(message).toContain('disputed');
  });

  it('rejects an empty project rather than searching every project', () => {
    const message = messageOf(() => searchTool.parse({ project: '   ' }));
    expect(message).toContain('project must not be empty');
  });

  it('rejects a blank text query and offers omitting it', () => {
    const message = messageOf(() => searchTool.parse({ project: 'p', text: '   ' }));
    expect(message).toContain('omit the argument');
  });

  it('rejects an empty kinds array instead of silently matching nothing', () => {
    const message = messageOf(() => searchTool.parse({ project: 'p', kinds: [] }));
    expect(message).toContain('at least one kind');
  });

  it('rejects a limit that would crowd out a rehydration slice', () => {
    const message = messageOf(() =>
      searchTool.parse({ project: 'p', limit: MAX_SEARCH_LIMIT + 1 }),
    );
    expect(message).toContain('limit must be at most');
    expect(message).toContain('mneia_rehydrate');
  });

  it('rejects a fractional limit', () => {
    const message = messageOf(() => searchTool.parse({ project: 'p', limit: 3.5 }));
    expect(message).toContain('limit must be a whole number');
  });
});

describe('mneia_search filters', () => {
  it('passes every supplied filter through to the store unchanged', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool(
      {
        project: 'payments-migration',
        text: 'idempotency key',
        kinds: ['constraint', 'decision'],
        statuses: ['active', 'superseded'],
        loadBearing: true,
        limit: 5,
      },
      fake,
      telemetry,
    );

    expect(searchArgumentOf(fake)).toEqual({
      projectId: PROJECT_ID,
      text: 'idempotency key',
      kinds: ['constraint', 'decision'],
      statuses: ['active', 'superseded'],
      loadBearing: true,
      limit: 5,
      asOf: NOW,
    });
  });

  it('omits an unsupplied filter entirely rather than sending undefined', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ project: 'payments-migration' }, fake, telemetry);

    const search = searchArgumentOf(fake);
    expect('text' in search).toBe(false);
    expect('kinds' in search).toBe(false);
    expect('loadBearing' in search).toBe(false);
    expect(search.statuses).toEqual(['active']);
    expect(search.limit).toBe(DEFAULT_SEARCH_LIMIT);
  });

  it('reads the store as of now so a future-dated item is not returned', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ project: 'payments-migration' }, fake, telemetry);

    expect(searchArgumentOf(fake).asOf).toEqual(NOW);
  });

  it('resolves a slug by slug and an id by id', async () => {
    const bySlug = createStore();
    const telemetry = createTelemetry();
    await runTool({ project: 'payments-migration' }, bySlug, telemetry);
    expect(bySlug.calls[0]?.method).toBe('getProjectBySlug');

    const byId = createStore();
    await runTool({ project: PROJECT_ID }, byId, telemetry);
    expect(byId.calls[0]?.method).toBe('getProject');
  });
});

describe('mneia_search results', () => {
  it('returns a compact row per item with the full id an agent can supersede', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool({ project: 'payments-migration' }, fake, telemetry);

    expect(result.isError).toBeUndefined();
    expect(structuredOf(result).projectId).toBe(PROJECT_ID);
    expect(structuredOf(result).matchCount).toBe(2);

    const [first] = itemsOf(result);
    expect(first).toEqual({
      itemId: CONSTRAINT.id,
      kind: 'constraint',
      title: CONSTRAINT.title,
      status: 'active',
      humanConfirmed: true,
      loadBearing: true,
      confidence: 1,
      assertedAt: ASSERTED_AT.toISOString(),
      sourceRef: 'https://example.invalid/pr/412',
      supersededById: null,
    });
  });

  it('keeps the item body out of the structured rows so it cannot crowd the window', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool({ project: 'payments-migration' }, fake, telemetry);

    for (const item of itemsOf(result)) {
      expect('body' in item).toBe(false);
      expect('embedding' in item).toBe(false);
    }
  });

  it('marks a superseded match so an agent does not re-propose it', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { project: 'payments-migration', statuses: ['active', 'superseded'] },
      fake,
      telemetry,
    );

    const text = textOf(result);
    expect(text).toContain(SUPERSEDED_DECISION.id);
    expect(text).toContain('superseded');
    expect(text).toContain('load-bearing');
    expect(text).toContain('human-confirmed');
    expect(itemsOf(result)[1]?.supersededById).toBe(SUPERSEDED_DECISION.supersededById);
  });

  it('signals that the limit was reached so the agent knows there may be more', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const capped = await runTool({ project: 'payments-migration', limit: 1 }, fake, telemetry);
    expect(structuredOf(capped).limitReached).toBe(true);
    expect(textOf(capped)).toContain('there may be more');

    const uncapped = await runTool({ project: 'payments-migration' }, fake, telemetry);
    expect(structuredOf(uncapped).limitReached).toBe(false);
  });

  it('says nothing matched and how to widen instead of returning an empty list', async () => {
    const fake = createStore({ matches: [] });
    const telemetry = createTelemetry();
    const result = await runTool({ project: 'payments-migration', text: 'kafka' }, fake, telemetry);

    expect(result.isError).toBeUndefined();
    expect(structuredOf(result).matchCount).toBe(0);
    expect(textOf(result)).toContain('found no items');
    expect(textOf(result)).toContain('Widen the filters');
    expect(textOf(result)).toContain('before concluding nothing was recorded');
  });

  it('is a read and emits no telemetry at all', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool({ project: 'payments-migration', text: 'downtime' }, fake, telemetry);

    expect(telemetry.sink.events).toHaveLength(0);
  });
});

describe('mneia_search errors', () => {
  it('distinguishes an unbound project and names both fixes', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool({}, fake, telemetry);

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('project_not_bound');
    expect(textOf(result)).toContain('mneia init');
    expect(fake.calls).toHaveLength(0);
  });

  it('distinguishes a project that does not exist', async () => {
    const fake = createStore({ project: null });
    const telemetry = createTelemetry();
    const result = await runTool({ project: 'nope' }, fake, telemetry);

    expect(errorCodeOf(result)).toBe('project_not_found');
    expect(textOf(result)).toContain('"nope"');
  });

  it('reads the project this server is bound to when the call omits one', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await searchTool.run(
      searchTool.parse({}),
      createToolContextFixture(fake.store, telemetry.emitter, {
        now: NOW,
        defaultProject: 'payments-migration',
      }),
    );

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('payments-migration');
  });

  it('distinguishes an unreachable store from a bad argument', async () => {
    const fake = createStore({ failOn: 'searchContextItems' });
    const telemetry = createTelemetry();
    const result = await runTool({ project: 'payments-migration' }, fake, telemetry);

    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('not a bad argument');
    expect(textOf(result)).toContain('rather than assuming nothing was recorded');
  });
});
