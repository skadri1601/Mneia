import { createToolContextFixture } from './context-fixture.js';
import type {
  Actor,
  Checkpoint,
  CheckpointItem,
  CheckpointWrite,
  CheckpointWriteResult,
  ContextItem,
  MemoryTelemetrySink,
  NewContextItem,
  ScopedStore,
  TelemetryEmitter,
  Uuid,
} from '@mneia/core';
import { createMemorySink, createTelemetryEmitter } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { checkpointTool, MAX_CANDIDATES } from './checkpoint.js';
import type { ToolContext, ToolResult } from './types.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '22222222-2222-4222-8222-222222222222';
const HUMAN_ID = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT_ID = '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const CHECKPOINT_ID = '88888888-8888-4888-8888-888888888888';
const EXISTING_ID = '44444444-4444-4444-8444-444444444444';
const MISSING_ID = '99999999-9999-4999-8999-999999999999';
const SUCCESSOR_ID = '5c5c5c5c-5c5c-4c5c-8c5c-5c5c5c5c5c5c';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const ASSERTED_AT = new Date('2026-07-20T09:00:00.000Z');

const AGENT: Actor = {
  id: AGENT_ID,
  workspaceId: WORKSPACE_ID,
  kind: 'agent',
  displayName: 'claude-code',
  externalRef: null,
  createdAt: ASSERTED_AT,
};

const HUMAN: Actor = {
  id: HUMAN_ID,
  workspaceId: WORKSPACE_ID,
  kind: 'human',
  displayName: 'Priya',
  externalRef: null,
  createdAt: ASSERTED_AT,
};

const PLAIN_BODY = 'BODY-PLAIN-must-not-leak';
const LOAD_BEARING_BODY = 'BODY-LOAD-BEARING-must-not-leak';
const SUPERSEDING_BODY = 'BODY-SUPERSEDING-must-not-leak';

const PLAIN_CANDIDATE = {
  kind: 'fact',
  title: 'Ledger writes are cut over and green in staging',
  body: PLAIN_BODY,
};

const LOAD_BEARING_CANDIDATE = {
  kind: 'constraint',
  title: 'No downtime window; the cutover must be online',
  body: LOAD_BEARING_BODY,
  loadBearing: true,
};

const SUPERSEDING_CANDIDATE = {
  kind: 'decision',
  title: 'Read from v2 in the worker instead of the shadow table',
  body: SUPERSEDING_BODY,
  supersedesId: EXISTING_ID,
};

function contextItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: EXISTING_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    kind: 'decision',
    title: 'Read from the shadow table in the worker',
    body: 'BODY-EXISTING-must-not-leak',
    status: 'active',
    assertedBy: HUMAN_ID,
    assertedAt: ASSERTED_AT,
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.9,
    humanConfirmed: true,
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

const writtenId = (index: number): Uuid =>
  `a0000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function materialise(item: NewContextItem, index: number): ContextItem {
  return {
    id: item.id ?? writtenId(index),
    workspaceId: WORKSPACE_ID,
    projectId: item.projectId,
    kind: item.kind,
    title: item.title,
    body: item.body ?? null,
    status: 'active',
    assertedBy: item.assertedBy,
    assertedAt: NOW,
    sourceSessionId: item.sourceSessionId ?? null,
    sourceRef: item.sourceRef ?? null,
    confidence: item.confidence ?? 0.5,
    humanConfirmed: item.humanConfirmed ?? false,
    loadBearing: item.loadBearing ?? false,
    lastVerifiedAt: null,
    decayAfter: null,
    validFrom: NOW,
    validTo: null,
    supersedesId: item.supersedesId ?? null,
    supersededById: null,
    accessScope: item.accessScope ?? 'project',
    embedding: null,
    embeddingModel: null,
  };
}

interface StoreCall {
  readonly method: string;
  readonly argument: unknown;
}

interface FakeStoreOptions {
  readonly actor?: Actor | null;
  readonly existing?: ContextItem | null;
  readonly failOn?: string;
  readonly writtenCount?: number;
}

interface FakeStore {
  readonly store: ScopedStore;
  readonly calls: StoreCall[];
  readonly writes: CheckpointWrite[];
}

function unsupported(method: string): never {
  throw new Error(`ScopedStore.${method} is not used by mneia_checkpoint`);
}

function createStore(options: FakeStoreOptions = {}): FakeStore {
  const calls: StoreCall[] = [];
  const writes: CheckpointWrite[] = [];
  const actor = options.actor === undefined ? AGENT : options.actor;
  const existing = options.existing === undefined ? contextItem() : options.existing;

  function record(method: string, argument: unknown): void {
    calls.push({ method, argument });
    if (options.failOn === method) {
      throw new Error('connect ECONNREFUSED 10.0.0.4:5432');
    }
  }

  const store: ScopedStore = {
    scope: { workspaceId: WORKSPACE_ID, actorId: actor === null ? AGENT_ID : actor.id },

    async getActor(id: Uuid): Promise<Actor | null> {
      record('getActor', id);
      return actor;
    },
    async getContextItem(id: Uuid): Promise<ContextItem | null> {
      record('getContextItem', id);
      return existing === null || existing.id !== id ? null : existing;
    },
    async writeCheckpoint(write: CheckpointWrite): Promise<CheckpointWriteResult> {
      record('writeCheckpoint', write);
      writes.push(write);

      const checkpoint: Checkpoint = {
        id: CHECKPOINT_ID,
        workspaceId: WORKSPACE_ID,
        projectId: write.checkpoint.projectId,
        sessionId: write.checkpoint.sessionId ?? null,
        actorId: write.checkpoint.actorId,
        trigger: write.checkpoint.trigger,
        createdAt: NOW,
        summary: write.checkpoint.summary ?? null,
      };

      const kept = write.items.slice(0, options.writtenCount ?? write.items.length);
      const written = kept.map((entry, index) => materialise(entry.item, index));
      const items: CheckpointItem[] = written.map((item, index) => ({
        workspaceId: WORKSPACE_ID,
        checkpointId: CHECKPOINT_ID,
        itemId: item.id,
        action: kept[index]?.action ?? 'created',
      }));

      return { checkpoint, items, written };
    },

    getProjectBySlug: () => unsupported('getProjectBySlug'),
    getProject: () => unsupported('getProject'),
    createSession: () => unsupported('createSession'),
    endSession: () => unsupported('endSession'),
    listContextItems: () => unsupported('listContextItems'),
    searchContextItems: () => unsupported('searchContextItems'),
    insertContextItem: () => unsupported('insertContextItem'),
    supersedeContextItem: () => unsupported('supersedeContextItem'),
    getCheckpoint: () => unsupported('getCheckpoint'),
    listCheckpoints: () => unsupported('listCheckpoints'),
    createHandoff: () => unsupported('createHandoff'),
    receiveHandoff: () => unsupported('receiveHandoff'),
    getHandoff: () => unsupported('getHandoff'),
    recordConflict: () => unsupported('recordConflict'),
    listOpenConflicts: () => unsupported('listOpenConflicts'),
    resolveConflict: () => unsupported('resolveConflict'),
  };

  return { store, calls, writes };
}

interface FakeTelemetry {
  readonly emitter: TelemetryEmitter;
  readonly sink: MemoryTelemetrySink;
}

function createTelemetry(options: { readonly throwOnEmit?: boolean } = {}): FakeTelemetry {
  const failing = options.throwOnEmit === true;
  const sink = createMemorySink(
    failing ? { fail: () => new Error('telemetry sink unreachable') } : {},
  );
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

function pendingOf(result: ToolResult): readonly Record<string, unknown>[] {
  const { pending } = structuredOf(result);
  if (!Array.isArray(pending)) {
    throw new Error('tool returned no pending queue');
  }
  return pending as readonly Record<string, unknown>[];
}

function firstPendingOf(result: ToolResult): Record<string, unknown> {
  const [entry] = pendingOf(result);
  if (entry === undefined) {
    throw new Error('expected at least one pending entry');
  }
  return entry;
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the call to throw');
}

function writtenItemsOf(write: CheckpointWrite): readonly NewContextItem[] {
  return write.items.map((entry) => entry.item);
}

async function runTool(
  raw: unknown,
  fake: FakeStore,
  telemetry: FakeTelemetry,
): Promise<ToolResult> {
  return checkpointTool.run(
    checkpointTool.parse(raw),
    createContext(fake.store, telemetry.emitter),
  );
}

describe('mneia_checkpoint surface', () => {
  it('is named and described so an agent knows when to reach for it', () => {
    expect(checkpointTool.name).toBe('mneia_checkpoint');
    expect(checkpointTool.description).toContain('pending queue');
    expect(checkpointTool.description).toContain('never written automatically');
    expect(checkpointTool.description).toContain('mneia_assert');
  });

  it('advertises only the genuinely required arguments', () => {
    expect(checkpointTool.inputSchema).toMatchObject({
      type: 'object',
      required: ['projectId', 'items'],
    });
  });

  it('does not advertise defaulted arguments as required', () => {
    const { properties } = checkpointTool.inputSchema as {
      properties: Record<string, { items?: { required?: readonly string[] } }>;
    };
    expect(properties.items?.items?.required).toEqual(['kind', 'title']);
  });
});

describe('mneia_checkpoint input validation', () => {
  it('applies the documented defaults to a minimal candidate', () => {
    expect(
      checkpointTool.parse({ projectId: PROJECT_ID, items: [{ kind: 'fact', title: 'green' }] }),
    ).toEqual({
      projectId: PROJECT_ID,
      trigger: 'task_boundary',
      items: [
        {
          kind: 'fact',
          title: 'green',
          confidence: 0.5,
          loadBearing: false,
          accessScope: 'project',
        },
      ],
    });
  });

  it('rejects a checkpoint with no candidates', () => {
    const message = messageOf(() => checkpointTool.parse({ projectId: PROJECT_ID, items: [] }));
    expect(message).toContain('mneia_checkpoint rejected the input [invalid_input]');
    expect(message).toContain('at least one extracted candidate');
  });

  it('rejects a batch larger than one checkpoint should carry', () => {
    const items = Array.from({ length: MAX_CANDIDATES + 1 }, (_unused, index) => ({
      kind: 'fact',
      title: `item ${index}`,
    }));
    const message = messageOf(() => checkpointTool.parse({ projectId: PROJECT_ID, items }));
    expect(message).toContain(`at most ${MAX_CANDIDATES} candidates`);
    expect(message).toContain('several checkpoints');
  });

  it('names the allowed kinds when one is wrong', () => {
    const message = messageOf(() =>
      checkpointTool.parse({ projectId: PROJECT_ID, items: [{ kind: 'note', title: 'x' }] }),
    );
    expect(message).toContain('kind must be one of');
    expect(message).toContain('open_question');
  });

  it('names the allowed triggers when one is wrong', () => {
    const message = messageOf(() =>
      checkpointTool.parse({
        projectId: PROJECT_ID,
        trigger: 'whenever',
        items: [{ kind: 'fact', title: 'x' }],
      }),
    );
    expect(message).toContain('trigger must be one of');
    expect(message).toContain('pre_compaction');
  });

  it('rejects a blank title rather than storing an unreadable item', () => {
    const message = messageOf(() =>
      checkpointTool.parse({ projectId: PROJECT_ID, items: [{ kind: 'fact', title: '   ' }] }),
    );
    expect(message).toContain('items.0.title');
  });

  it('rejects a projectId that is not a uuid', () => {
    const message = messageOf(() =>
      checkpointTool.parse({ projectId: 'payments', items: [{ kind: 'fact', title: 'x' }] }),
    );
    expect(message).toContain('projectId');
  });

  it('rejects a supersedesId that is not a uuid', () => {
    const message = messageOf(() =>
      checkpointTool.parse({
        projectId: PROJECT_ID,
        items: [{ kind: 'fact', title: 'x', supersedesId: 'the-old-one' }],
      }),
    );
    expect(message).toContain('items.0.supersedesId');
  });
});

describe('mneia_checkpoint writes', () => {
  it('writes plain candidates in one atomic checkpoint and reports nothing pending', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        summary: 'cut the ledger over',
        items: [PLAIN_CANDIDATE, { kind: 'open_question', title: 'Who owns the rollback drill?' }],
      },
      fake,
      telemetry,
    );

    expect(result.isError).toBeUndefined();
    expect(fake.writes).toHaveLength(1);

    const structured = structuredOf(result);
    expect(structured.status).toBe('written');
    expect(structured.pendingCount).toBe(0);
    expect(structured.writtenCount).toBe(2);
    expect(structured.checkpointId).toBe(CHECKPOINT_ID);
    expect(structured.trigger).toBe('task_boundary');
    expect(textOf(result)).toContain('nothing is pending');
  });

  it('attributes every written item to the authenticated actor, never to tool input', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool(
      { projectId: PROJECT_ID, sessionId: SESSION_ID, items: [PLAIN_CANDIDATE] },
      fake,
      telemetry,
    );

    const [write] = fake.writes;
    if (write === undefined) {
      throw new Error('expected a checkpoint write');
    }
    expect(write.checkpoint.actorId).toBe(AGENT_ID);
    expect(write.checkpoint.trigger).toBe('task_boundary');
    expect(write.items.every((entry) => entry.action === 'created')).toBe(true);

    const [item] = writtenItemsOf(write);
    expect(item?.assertedBy).toBe(AGENT_ID);
    expect(item?.humanConfirmed).toBe(false);
    expect(item?.sourceSessionId).toBe(SESSION_ID);
    expect(item?.supersedesId).toBeNull();
  });

  it('marks an item human_confirmed from the actor kind, not from a caller flag', async () => {
    const fake = createStore({ actor: HUMAN });
    const telemetry = createTelemetry();
    await runTool(
      { projectId: PROJECT_ID, items: [{ ...PLAIN_CANDIDATE, humanConfirmed: true }] },
      fake,
      telemetry,
    );

    const [write] = fake.writes;
    const [item] = write === undefined ? [] : writtenItemsOf(write);
    expect(item?.humanConfirmed).toBe(true);
    expect(item?.assertedBy).toBe(HUMAN_ID);
  });
});

describe('mneia_checkpoint pending queue', () => {
  it('holds a load-bearing candidate for a human and never writes it', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [LOAD_BEARING_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(fake.writes).toHaveLength(0);
    expect(fake.calls.map((call) => call.method)).not.toContain('writeCheckpoint');

    const structured = structuredOf(result);
    expect(structured.status).toBe('pending_human_confirmation');
    expect(structured.pendingCount).toBe(1);
    expect(structured.writtenCount).toBe(0);
    expect(structured.checkpointId).toBeNull();

    const entry = firstPendingOf(result);
    expect(entry.index).toBe(0);
    expect(entry.outcome).toBe('requires_human_confirmation');
    expect(entry.loadBearing).toBe(true);
    expect(entry.reason).toContain('§10.1 step 5');
  });

  it('holds a contradicting candidate even when the arbitration rules would allow it', async () => {
    const fake = createStore({ actor: HUMAN, existing: contextItem({ assertedBy: HUMAN_ID }) });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [SUPERSEDING_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(fake.writes).toHaveLength(0);

    const entry = firstPendingOf(result);
    expect(entry.outcome).toBe('requires_human_confirmation');
    expect(entry.supersedesId).toBe(EXISTING_ID);
    expect(entry.reason).toContain('contradicts');
    expect(entry.reason).toContain('§10.1 step 5');
  });

  it('never writes an agent assertion over a human-confirmed item', async () => {
    const fake = createStore({ existing: contextItem({ humanConfirmed: true }) });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [SUPERSEDING_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(fake.writes).toHaveLength(0);
    expect(fake.calls.map((call) => call.method)).not.toContain('writeCheckpoint');
    expect(fake.calls.map((call) => call.method)).not.toContain('supersedeContextItem');
    expect(fake.calls.map((call) => call.method)).not.toContain('insertContextItem');
    expect(telemetry.sink.events).toHaveLength(0);

    const entry = firstPendingOf(result);
    expect(entry.outcome).toBe('requires_human_confirmation');
    expect(entry.existingHumanConfirmed).toBe(true);
    expect(entry.reason).toContain('human_confirmed');
    expect(entry.reason).toContain('never auto-supersedes');
  });

  it('marks a supersede the rules refuse outright as refused, not merely unconfirmed', async () => {
    const fake = createStore({
      existing: contextItem({ humanConfirmed: false, supersededById: SUCCESSOR_ID }),
    });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [SUPERSEDING_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(fake.writes).toHaveLength(0);

    const entry = firstPendingOf(result);
    expect(entry.outcome).toBe('refused');
    expect(entry.nextStep).toContain('A human confirmation will not fix this');
    expect(textOf(result)).toContain('REFUSED');
  });

  it('writes the plain candidates while holding the load-bearing and contradicting ones', async () => {
    const fake = createStore({ existing: contextItem({ humanConfirmed: true }) });
    const telemetry = createTelemetry();
    const result = await runTool(
      {
        projectId: PROJECT_ID,
        items: [LOAD_BEARING_CANDIDATE, PLAIN_CANDIDATE, SUPERSEDING_CANDIDATE],
      },
      fake,
      telemetry,
    );

    expect(fake.writes).toHaveLength(1);

    const [write] = fake.writes;
    const items = write === undefined ? [] : writtenItemsOf(write);
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe(PLAIN_CANDIDATE.title);
    expect(items.every((item) => item.loadBearing !== true)).toBe(true);
    expect(items.every((item) => (item.supersedesId ?? null) === null)).toBe(true);

    const structured = structuredOf(result);
    expect(structured.status).toBe('partially_written');
    expect(structured.pendingCount).toBe(2);
    expect(structured.writtenCount).toBe(1);
    expect(pendingOf(result).map((entry) => entry.index)).toEqual([0, 2]);
  });

  it('reports which submitted candidate each outcome belongs to', async () => {
    const fake = createStore({ existing: contextItem({ humanConfirmed: true }) });
    const telemetry = createTelemetry();
    const result = await runTool(
      {
        projectId: PROJECT_ID,
        items: [LOAD_BEARING_CANDIDATE, PLAIN_CANDIDATE, SUPERSEDING_CANDIDATE],
      },
      fake,
      telemetry,
    );

    const { written } = structuredOf(result);
    if (!Array.isArray(written)) {
      throw new Error('tool returned no written list');
    }
    expect(written.map((entry: Record<string, unknown>) => entry.index)).toEqual([1]);
    expect(written[0]?.itemId).toBe(writtenId(0));

    const covered = [
      ...pendingOf(result).map((entry) => entry.index),
      ...written.map((entry: Record<string, unknown>) => entry.index),
    ].sort();
    expect(covered).toEqual([0, 1, 2]);
  });

  it('makes the pending queue impossible to skim past in the text content', async () => {
    const fake = createStore({ existing: contextItem({ humanConfirmed: true }) });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [PLAIN_CANDIDATE, LOAD_BEARING_CANDIDATE] },
      fake,
      telemetry,
    );

    const text = textOf(result);
    const headline = text.split('\n')[0] ?? '';
    expect(headline).toContain('PENDING HUMAN CONFIRMATION');
    expect(text.indexOf('PENDING HUMAN CONFIRMATION')).toBeLessThan(text.indexOf('Written to'));
    expect(text).toContain(LOAD_BEARING_CANDIDATE.title);

    const pendingBlock = text.slice(
      text.indexOf('PENDING HUMAN CONFIRMATION —'),
      text.indexOf('Written to'),
    );
    expect(pendingBlock).toContain('items[1]');
    expect(pendingBlock).not.toContain('items[0]');
    expect(text).toContain('routes around the confirmation');
  });
});

describe('mneia_checkpoint errors', () => {
  it('fails the whole checkpoint when a supersedesId does not resolve', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    const result = await runTool(
      {
        projectId: PROJECT_ID,
        items: [PLAIN_CANDIDATE, { ...SUPERSEDING_CANDIDATE, supersedesId: MISSING_ID }],
      },
      fake,
      telemetry,
    );

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('unknown_supersedes_id');
    expect(textOf(result)).toContain('items[1]');
    expect(textOf(result)).toContain('mneia_search');
    expect(fake.writes).toHaveLength(0);
    expect(telemetry.sink.events).toHaveLength(0);
  });

  it('refuses to supersede an item belonging to another project', async () => {
    const fake = createStore({ existing: contextItem({ projectId: OTHER_PROJECT_ID }) });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [SUPERSEDING_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(errorCodeOf(result)).toBe('project_mismatch');
    expect(fake.writes).toHaveLength(0);
  });

  it('names an unauthenticated actor as the cause instead of writing anonymously', async () => {
    const fake = createStore({ actor: null });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [PLAIN_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(errorCodeOf(result)).toBe('actor_not_found');
    expect(textOf(result)).toContain('Re-authenticate');
    expect(fake.writes).toHaveLength(0);
  });

  it('distinguishes an unreachable store from a bad argument', async () => {
    const fake = createStore({ failOn: 'writeCheckpoint' });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [PLAIN_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('Nothing was written');
    expect(telemetry.sink.events).toHaveLength(0);
  });

  it('reports a short write rather than claiming items were stored', async () => {
    const fake = createStore({ writtenCount: 0 });
    const telemetry = createTelemetry();
    const result = await runTool(
      { projectId: PROJECT_ID, items: [PLAIN_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(errorCodeOf(result)).toBe('write_incomplete');
    expect(telemetry.sink.events).toHaveLength(0);
  });
});

describe('mneia_checkpoint telemetry', () => {
  it('emits checkpoint.item_extracted once per written item with the checkpoint and item ids', async () => {
    const fake = createStore();
    const telemetry = createTelemetry();
    await runTool(
      {
        projectId: PROJECT_ID,
        sessionId: SESSION_ID,
        trigger: 'day_boundary',
        items: [PLAIN_CANDIDATE, { kind: 'artifact_ref', title: 'PR #412', confidence: 1 }],
      },
      fake,
      telemetry,
    );

    const extracted = telemetry.sink.eventsOf('checkpoint.item_extracted');
    expect(extracted).toHaveLength(2);
    expect(extracted.map((event) => event.itemId)).toEqual([writtenId(0), writtenId(1)]);

    const [first] = extracted;
    if (first === undefined) {
      throw new Error('expected a checkpoint.item_extracted event');
    }
    expect(first.checkpointId).toBe(CHECKPOINT_ID);
    expect(first.workspaceId).toBe(WORKSPACE_ID);
    expect(first.projectId).toBe(PROJECT_ID);
    expect(first.actorId).toBe(AGENT_ID);
    expect(first.sessionId).toBe(SESSION_ID);
    expect(first.occurredAt).toEqual(NOW);
    expect(first.trigger).toBe('day_boundary');
    expect(first.kind).toBe('fact');
    expect(first.loadBearing).toBe(false);
  });

  it('emits checkpoint.item_confirmed only when the authenticated actor is a human', async () => {
    const agentRun = createStore();
    const agentTelemetry = createTelemetry();
    await runTool({ projectId: PROJECT_ID, items: [PLAIN_CANDIDATE] }, agentRun, agentTelemetry);
    expect(agentTelemetry.sink.countOf('checkpoint.item_confirmed')).toBe(0);

    const humanRun = createStore({ actor: HUMAN });
    const humanTelemetry = createTelemetry();
    await runTool({ projectId: PROJECT_ID, items: [PLAIN_CANDIDATE] }, humanRun, humanTelemetry);

    const confirmed = humanTelemetry.sink.eventsOf('checkpoint.item_confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.itemId).toBe(writtenId(0));
    expect(confirmed[0]?.checkpointId).toBe(CHECKPOINT_ID);
    expect(confirmed[0]?.actorId).toBe(HUMAN_ID);
  });

  it('emits nothing for a candidate held in the pending queue', async () => {
    const fake = createStore({ existing: contextItem({ humanConfirmed: true }) });
    const telemetry = createTelemetry();
    await runTool(
      {
        projectId: PROJECT_ID,
        items: [LOAD_BEARING_CANDIDATE, PLAIN_CANDIDATE, SUPERSEDING_CANDIDATE],
      },
      fake,
      telemetry,
    );

    expect(telemetry.sink.events).toHaveLength(1);
    expect(telemetry.sink.saw('item.superseded')).toBe(false);
    expect(telemetry.sink.eventsOf('checkpoint.item_extracted')[0]?.itemId).toBe(writtenId(0));
  });

  it('carries no item body and no item title in any event payload', async () => {
    const fake = createStore({ actor: HUMAN });
    const telemetry = createTelemetry();
    await runTool(
      { projectId: PROJECT_ID, items: [PLAIN_CANDIDATE, LOAD_BEARING_CANDIDATE] },
      fake,
      telemetry,
    );

    const serialised = JSON.stringify(telemetry.sink.events);
    for (const secret of [PLAIN_BODY, LOAD_BEARING_BODY, SUPERSEDING_BODY]) {
      expect(serialised).not.toContain(secret);
    }
    expect(serialised).not.toContain(PLAIN_CANDIDATE.title);
    expect(serialised).not.toContain(LOAD_BEARING_CANDIDATE.title);
  });

  it('still reports the write when the telemetry sink throws', async () => {
    const fake = createStore();
    const telemetry = createTelemetry({ throwOnEmit: true });
    const result = await runTool(
      { projectId: PROJECT_ID, items: [PLAIN_CANDIDATE] },
      fake,
      telemetry,
    );

    expect(result.isError).toBeUndefined();
    expect(structuredOf(result).writtenCount).toBe(1);
    expect(structuredOf(result).checkpointId).toBe(CHECKPOINT_ID);
    expect(telemetry.sink.events).toHaveLength(0);
  });
});
