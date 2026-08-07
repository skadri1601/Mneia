import { createToolContextFixture } from './context-fixture.js';
import type {
  Actor,
  ActorKind,
  Checkpoint,
  CheckpointAction,
  CheckpointItem,
  CheckpointWrite,
  CheckpointWriteResult,
  ContextItem,
  MemoryTelemetrySink,
  NewCheckpoint,
  NewContextItem,
  ScopedStore,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';
import { createMemorySink, createTelemetryEmitter, ITEM_STATUSES } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { createNoopReviewQueue } from '../review-queue.js';
import { createSliceLog } from '../slices.js';
import type { AssertInput } from './assert.js';
import { assertTool } from './assert.js';
import type { ToolContext, ToolResult } from './types.js';

const WORKSPACE_ID: Uuid = '11111111-1111-4111-8111-111111111111';
const AGENT_ACTOR_ID: Uuid = '22222222-2222-4222-8222-222222222222';
const HUMAN_ACTOR_ID: Uuid = '2222aaaa-2222-4222-8222-2222aaaa2222';
const OTHER_HUMAN_ACTOR_ID: Uuid = '2222bbbb-2222-4222-8222-2222bbbb2222';
const PROJECT_ID: Uuid = '33333333-3333-4333-8333-333333333333';
const OTHER_PROJECT_ID: Uuid = '3333cccc-3333-4333-8333-3333cccc3333';
const EXISTING_ITEM_ID: Uuid = '44444444-4444-4444-8444-444444444444';
const NEWER_ITEM_ID: Uuid = '4444dddd-4444-4444-8444-4444dddd4444';
const WRITTEN_ITEM_ID: Uuid = '55555555-5555-4555-8555-555555555555';
const CHECKPOINT_ID: Uuid = '66666666-6666-4666-8666-666666666666';
const SESSION_ID: Uuid = '77777777-7777-4777-8777-777777777777';
const SERVER_SESSION_ID: Uuid = '7777eeee-7777-4777-8777-7777eeee7777';
const UNKNOWN_ITEM_ID: Uuid = '88888888-8888-4888-8888-888888888888';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const CREATED_AT = new Date('2026-07-01T00:00:00.000Z');
const ASSERTED_AT = new Date('2026-07-20T09:00:00.000Z');

const SECRET_BODY = 'BODY-ASSERT-must-not-leak';
const EXISTING_BODY = 'BODY-EXISTING-must-not-leak';
const TITLE = 'Idempotency keys are namespaced per merchant';
const EXISTING_TITLE = 'Idempotency keys are global';

function actorOf(kind: ActorKind, id: Uuid): Actor {
  return {
    id,
    workspaceId: WORKSPACE_ID,
    kind,
    displayName: kind === 'human' ? 'priya' : 'claude-code',
    externalRef: null,
    createdAt: CREATED_AT,
  };
}

const AGENT = actorOf('agent', AGENT_ACTOR_ID);
const HUMAN = actorOf('human', HUMAN_ACTOR_ID);

function contextItem(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    id: EXISTING_ITEM_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    kind: 'constraint',
    title: EXISTING_TITLE,
    body: EXISTING_BODY,
    status: 'active',
    assertedBy: HUMAN_ACTOR_ID,
    assertedAt: ASSERTED_AT,
    sourceSessionId: null,
    sourceRef: null,
    confidence: 0.9,
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

const HUMAN_CONFIRMED_ITEM = contextItem({ humanConfirmed: true });
const LOAD_BEARING_ITEM = contextItem({ loadBearing: true, humanConfirmed: false });

const MINIMAL_RAW: Record<string, unknown> = {
  projectId: PROJECT_ID,
  kind: 'decision',
  title: TITLE,
};

const FULL_RAW: Record<string, unknown> = {
  ...MINIMAL_RAW,
  body: SECRET_BODY,
  sessionId: SESSION_ID,
  sourceRef: 'https://example.invalid/pr/42',
  confidence: 0.9,
  loadBearing: true,
  accessScope: 'team',
};

interface StoreCall {
  readonly method: string;
  readonly argument: unknown;
}

const MUTATING_METHODS: readonly string[] = [
  'writeCheckpoint',
  'insertContextItem',
  'supersedeContextItem',
  'createHandoff',
  'receiveHandoff',
  'recordConflict',
  'resolveConflict',
];

interface FakeStoreOptions {
  readonly actor?: Actor | null;
  readonly existing?: ContextItem | null;
  readonly failOn?: string;
  readonly writeReturnsNothing?: boolean;
}

interface FakeStore {
  readonly store: ScopedStore;
  readonly calls: StoreCall[];
}

function unsupported(method: string): never {
  throw new Error(`ScopedStore.${method} is not used by mneia_assert`);
}

function storedItem(item: NewContextItem, asserter: Actor): ContextItem {
  return {
    id: item.id ?? WRITTEN_ITEM_ID,
    workspaceId: WORKSPACE_ID,
    projectId: item.projectId,
    kind: item.kind,
    title: item.title,
    body: item.body ?? null,
    status: 'active',
    assertedBy: asserter.id,
    assertedAt: NOW,
    sourceSessionId: item.sourceSessionId ?? null,
    sourceRef: item.sourceRef ?? null,
    confidence: item.confidence ?? 0.5,
    humanConfirmed: asserter.kind === 'human',
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

function createStore(options: FakeStoreOptions = {}): FakeStore {
  const calls: StoreCall[] = [];
  const actor = options.actor === undefined ? AGENT : options.actor;
  const existing = options.existing === undefined ? HUMAN_CONFIRMED_ITEM : options.existing;

  function record(method: string, argument: unknown): void {
    calls.push({ method, argument });
    if (options.failOn === method) {
      throw new Error('connect ECONNREFUSED 10.0.0.4:5432');
    }
  }

  const store: ScopedStore = {
    scope: { workspaceId: WORKSPACE_ID, actorId: AGENT_ACTOR_ID },

    async getActor(id: Uuid): Promise<Actor | null> {
      record('getActor', id);
      return actor;
    },
    async getContextItem(id: Uuid): Promise<ContextItem | null> {
      record('getContextItem', id);
      return existing;
    },
    async writeCheckpoint(write: CheckpointWrite): Promise<CheckpointWriteResult> {
      record('writeCheckpoint', write);

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

      if (options.writeReturnsNothing === true) {
        return { checkpoint, items: [], written: [] };
      }

      const written = write.items.map((entry) => storedItem(entry.item, actor ?? AGENT));
      const items: CheckpointItem[] = write.items.map((entry, index) => ({
        workspaceId: WORKSPACE_ID,
        checkpointId: CHECKPOINT_ID,
        itemId: written[index]?.id ?? WRITTEN_ITEM_ID,
        action: entry.action,
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

  return { store, calls };
}

interface FakeTelemetry {
  readonly emitter: TelemetryEmitter;
  readonly sink: MemoryTelemetrySink;
  readonly raw: TelemetryEvent[];
}

interface TelemetryOptions {
  readonly sinkRejects?: boolean;
  readonly emitterThrows?: boolean;
}

function createTelemetry(options: TelemetryOptions = {}): FakeTelemetry {
  const raw: TelemetryEvent[] = [];
  const sink =
    options.sinkRejects === true
      ? createMemorySink({ fail: () => new Error('telemetry sink unreachable') })
      : createMemorySink();
  const delegate = createTelemetryEmitter({ sinks: [sink], enabled: true });

  const emitter: TelemetryEmitter = {
    emit(event: TelemetryEvent): Promise<void> {
      raw.push(event);
      if (options.emitterThrows === true) {
        throw new Error('telemetry emitter exploded');
      }
      return delegate.emit(event);
    },
    flush: () => delegate.flush(),
    close: () => delegate.close(),
  };

  return { emitter, sink, raw };
}

function createContext(store: ScopedStore, telemetry: TelemetryEmitter): ToolContext {
  return createToolContextFixture(store, telemetry, { now: NOW });
}

async function runTool(
  raw: unknown,
  fake: FakeStore,
  telemetry: FakeTelemetry,
): Promise<ToolResult> {
  return assertTool.run(assertTool.parse(raw), createContext(fake.store, telemetry.emitter));
}

async function runUnparsed(
  input: AssertInput,
  fake: FakeStore,
  telemetry: FakeTelemetry,
): Promise<ToolResult> {
  return assertTool.run(input, createContext(fake.store, telemetry.emitter));
}

function forge(base: AssertInput, fields: Record<string, unknown>): AssertInput {
  const forged: Record<string, unknown> = { ...base, ...fields };
  return forged as unknown as AssertInput;
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

function statusOf(result: ToolResult): string {
  const { status } = structuredOf(result);
  return typeof status === 'string' ? status : '';
}

function errorCodeOf(result: ToolResult): string {
  const { error } = structuredOf(result);
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    throw new Error('tool returned no structured error');
  }
  const { code } = error as { code: unknown };
  return typeof code === 'string' ? code : '';
}

function writtenOf(result: ToolResult): Record<string, unknown> {
  const { written } = structuredOf(result);
  if (typeof written !== 'object' || written === null) {
    throw new Error('tool reported no written item');
  }
  return written as Record<string, unknown>;
}

function checkpointWriteOf(fake: FakeStore): CheckpointWrite {
  const call = fake.calls.find((candidate) => candidate.method === 'writeCheckpoint');
  if (call === undefined) {
    throw new Error('expected the tool to call ScopedStore.writeCheckpoint');
  }
  return call.argument as CheckpointWrite;
}

function submittedItem(fake: FakeStore): NewContextItem {
  const [entry] = checkpointWriteOf(fake).items;
  if (entry === undefined) {
    throw new Error('expected the checkpoint write to carry one item');
  }
  return entry.item;
}

function submittedAction(fake: FakeStore): CheckpointAction {
  const [entry] = checkpointWriteOf(fake).items;
  if (entry === undefined) {
    throw new Error('expected the checkpoint write to carry one item');
  }
  return entry.action;
}

function submittedCheckpoint(fake: FakeStore): NewCheckpoint {
  return checkpointWriteOf(fake).checkpoint;
}

function mutations(fake: FakeStore): readonly string[] {
  return fake.calls
    .filter((call) => MUTATING_METHODS.includes(call.method))
    .map((call) => call.method);
}

function messageOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected the call to throw');
}

describe('mneia_assert surface', () => {
  it('is named and described so an agent can pick it without reading the code', () => {
    expect(assertTool.name).toBe('mneia_assert');
    expect(assertTool.description).toContain('supersedesId');
    expect(assertTool.description).toContain('pending');
    expect(assertTool.inputSchema).toMatchObject({ type: 'object' });
  });

  it('advertises no field through which a caller could claim human confirmation', () => {
    const properties = (assertTool.inputSchema as { readonly properties?: unknown }).properties;
    if (typeof properties !== 'object' || properties === null) {
      throw new Error('expected the input schema to declare properties');
    }

    expect(Object.keys(properties).sort()).toEqual(
      [
        'accessScope',
        'body',
        'confidence',
        'kind',
        'loadBearing',
        'projectId',
        'sessionId',
        'sourceRef',
        'supersedesId',
        'title',
      ].sort(),
    );
  });
});

describe('mneia_assert input validation', () => {
  it('accepts the three required fields and applies the documented defaults', () => {
    expect(assertTool.parse(MINIMAL_RAW)).toEqual({
      projectId: PROJECT_ID,
      kind: 'decision',
      title: TITLE,
      confidence: 0.5,
      loadBearing: false,
      accessScope: 'project',
    });
  });

  it('accepts a full input and trims the title', () => {
    expect(assertTool.parse({ ...FULL_RAW, title: `  ${TITLE}  ` })).toEqual({
      projectId: PROJECT_ID,
      kind: 'decision',
      title: TITLE,
      body: SECRET_BODY,
      sessionId: SESSION_ID,
      sourceRef: 'https://example.invalid/pr/42',
      confidence: 0.9,
      loadBearing: true,
      accessScope: 'team',
    });
  });

  it('names the tool, the failing field, and the fix when input is rejected', () => {
    const message = messageOf(() => assertTool.parse({}));
    expect(message).toContain('mneia_assert rejected the input');
    expect(message).toContain('[invalid_input]');
    expect(message).toContain('projectId');
    expect(message).toContain('kind');
    expect(message).toContain('title');
    expect(message).toContain('Correct the named fields and call the tool again');
  });

  it('rejects a projectId that is not a uuid', () => {
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, projectId: 'payments' }))).toContain(
      'projectId',
    );
  });

  it('rejects an unknown kind and lists the five it accepts', () => {
    const message = messageOf(() => assertTool.parse({ ...MINIMAL_RAW, kind: 'memory' }));
    expect(message).toContain('kind must be one of');
    expect(message).toContain('decision');
    expect(message).toContain('constraint');
    expect(message).toContain('open_question');
    expect(message).toContain('fact');
    expect(message).toContain('artifact_ref');
  });

  it('rejects an empty title rather than storing a blank item', () => {
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, title: '   ' }))).toContain('title');
  });

  it('rejects an over-long title rather than truncating it', () => {
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, title: 'x'.repeat(301) }))).toContain(
      'title',
    );
  });

  it('rejects an over-long body rather than truncating it', () => {
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, body: 'x'.repeat(8001) }))).toContain(
      'body',
    );
  });

  it('rejects a confidence outside 0 to 1 at both ends', () => {
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, confidence: -0.1 }))).toContain(
      'confidence',
    );
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, confidence: 1.1 }))).toContain(
      'confidence',
    );
  });

  it('rejects a non-boolean loadBearing', () => {
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, loadBearing: 'yes' }))).toContain(
      'loadBearing',
    );
  });

  it('rejects an unknown accessScope and lists the five it accepts', () => {
    const message = messageOf(() => assertTool.parse({ ...MINIMAL_RAW, accessScope: 'public' }));
    expect(message).toContain('accessScope must be one of');
    expect(message).toContain('private');
    expect(message).toContain('restricted');
  });

  it('rejects a sessionId or supersedesId that is not a uuid', () => {
    expect(messageOf(() => assertTool.parse({ ...MINIMAL_RAW, sessionId: 'last' }))).toContain(
      'sessionId',
    );
    expect(
      messageOf(() => assertTool.parse({ ...MINIMAL_RAW, supersedesId: 'the old one' })),
    ).toContain('supersedesId');
  });

  it('rejects a non-object payload', () => {
    expect(messageOf(() => assertTool.parse('just record it'))).toContain('mneia_assert');
    expect(messageOf(() => assertTool.parse(null))).toContain('mneia_assert');
  });
});

interface Smuggle {
  readonly label: string;
  readonly fields: Record<string, unknown>;
}

const SMUGGLE_VARIANTS: readonly Smuggle[] = [
  { label: 'nothing smuggled', fields: {} },
  { label: 'humanConfirmed=true', fields: { humanConfirmed: true } },
  { label: 'humanConfirmedByAsserter=true', fields: { humanConfirmedByAsserter: true } },
  { label: 'actorKind=human', fields: { actorKind: 'human' } },
  { label: 'actor={kind:human}', fields: { actor: { id: HUMAN_ACTOR_ID, kind: 'human' } } },
  { label: 'assertedBy=a human', fields: { assertedBy: HUMAN_ACTOR_ID } },
  {
    label: 'scope={actorId:a human}',
    fields: { scope: { workspaceId: WORKSPACE_ID, actorId: HUMAN_ACTOR_ID } },
  },
  { label: 'status=active', fields: { status: 'active', supersededById: null } },
  {
    label: 'every smuggling field at once',
    fields: {
      humanConfirmed: true,
      humanConfirmedByAsserter: true,
      actorKind: 'human',
      actor: { id: HUMAN_ACTOR_ID, kind: 'human' },
      assertedBy: HUMAN_ACTOR_ID,
      scope: { workspaceId: WORKSPACE_ID, actorId: HUMAN_ACTOR_ID },
      confirmed: true,
      confirmedBy: HUMAN_ACTOR_ID,
    },
  },
];

describe('mneia_assert never accepts human confirmation from tool input', () => {
  it('drops every confirmation-shaped key at the parse boundary', () => {
    for (const variant of SMUGGLE_VARIANTS) {
      const parsed = assertTool.parse({ ...MINIMAL_RAW, ...variant.fields });

      expect(Object.keys(parsed).sort(), variant.label).toEqual(
        ['projectId', 'kind', 'title', 'confidence', 'loadBearing', 'accessScope'].sort(),
      );
      expect(JSON.stringify(parsed), variant.label).not.toContain('humanConfirmed');
      expect(JSON.stringify(parsed), variant.label).not.toContain(HUMAN_ACTOR_ID);
    }
  });

  it('writes an unconfirmed item when an agent claims a human already confirmed it', async () => {
    for (const variant of SMUGGLE_VARIANTS) {
      const fake = createStore({ actor: AGENT, existing: null });
      const telemetry = createTelemetry();
      const result = await runTool({ ...FULL_RAW, ...variant.fields }, fake, telemetry);

      expect(statusOf(result), variant.label).toBe('written');
      expect(Object.keys(submittedItem(fake)), variant.label).not.toContain('humanConfirmed');
      expect(Object.keys(submittedItem(fake)), variant.label).not.toContain('assertedBy');
      expect(writtenOf(result).humanConfirmed, variant.label).toBe(false);
      expect(textOf(result), variant.label).toContain('unconfirmed');
    }
  });

  it('still holds the load-bearing gate against an agent claiming confirmation', async () => {
    for (const variant of SMUGGLE_VARIANTS) {
      const fake = createStore({ actor: AGENT, existing: LOAD_BEARING_ITEM });
      const telemetry = createTelemetry();
      const result = await runTool(
        { ...MINIMAL_RAW, ...variant.fields, supersedesId: EXISTING_ITEM_ID },
        fake,
        telemetry,
      );

      expect(statusOf(result), variant.label).toBe('pending_human_confirmation');
      expect(mutations(fake), variant.label).toEqual([]);
      expect(textOf(result), variant.label).toContain('PENDING HUMAN CONFIRMATION');
    }
  });

  it('ignores a smuggled __proto__ payload and leaves Object.prototype alone', () => {
    const polluted: unknown = JSON.parse(
      '{"projectId":"33333333-3333-4333-8333-333333333333","kind":"decision","title":"t","__proto__":{"humanConfirmed":true}}',
    );
    const parsed = assertTool.parse(polluted);

    expect(Object.keys(parsed).sort()).toEqual(
      ['projectId', 'kind', 'title', 'confidence', 'loadBearing', 'accessScope'].sort(),
    );
    expect('humanConfirmed' in Object.prototype).toBe(false);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it('advertises a closed object, so a validating client rejects a smuggled field before it is sent', () => {
    const schema = assertTool.inputSchema as { readonly additionalProperties?: unknown };
    expect(schema.additionalProperties).toBe(false);
  });

  it('requires only the three fields a caller must genuinely supply, and never a ratified one', () => {
    const schema = assertTool.inputSchema as { readonly required?: unknown };

    const required = schema.required;
    if (!Array.isArray(required)) {
      throw new Error('expected the input schema to declare a required list');
    }

    expect([...required].sort()).toEqual(['kind', 'projectId', 'title']);
    for (const ratified of ['confidence', 'loadBearing', 'accessScope']) {
      expect(required).not.toContain(ratified);
    }
  });

  it('accepts an extra field from a non-validating client by stripping it, never by honouring it', () => {
    const parsed = assertTool.parse({ ...MINIMAL_RAW, thisFieldDoesNotExist: true });
    expect('thisFieldDoesNotExist' in parsed).toBe(false);
  });
});

describe('mneia_assert reads actor kind from the store, never from the caller', () => {
  it('looks the actor up by the scope actor id and by nothing else', async () => {
    const fake = createStore({ actor: AGENT, existing: null });
    const telemetry = createTelemetry();
    await runTool({ ...FULL_RAW, assertedBy: HUMAN_ACTOR_ID }, fake, telemetry);

    const lookup = fake.calls.find((call) => call.method === 'getActor');
    expect(lookup?.argument).toBe(AGENT_ACTOR_ID);
    expect(lookup?.argument).toBe(fake.store.scope.actorId);
  });

  it('confirms the item when the authenticated actor is a human, with no flag in the input', async () => {
    const fake = createStore({ actor: HUMAN, existing: null });
    const telemetry = createTelemetry();
    const result = await runTool(MINIMAL_RAW, fake, telemetry);

    expect(Object.keys(submittedItem(fake))).not.toContain('humanConfirmed');
    expect(Object.keys(submittedItem(fake))).not.toContain('assertedBy');
    expect(writtenOf(result).humanConfirmed).toBe(true);
    expect(textOf(result)).toContain('human-confirmed');
  });

  it('lifts the load-bearing gate for a human actor and holds it for an agent', async () => {
    const asAgent = createStore({ actor: AGENT, existing: LOAD_BEARING_ITEM });
    const agentResult = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      asAgent,
      createTelemetry(),
    );

    expect(statusOf(agentResult)).toBe('pending_human_confirmation');
    expect(mutations(asAgent)).toEqual([]);

    const asHuman = createStore({ actor: HUMAN, existing: LOAD_BEARING_ITEM });
    const humanResult = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      asHuman,
      createTelemetry(),
    );

    expect(statusOf(humanResult)).toBe('written');
    expect(submittedItem(asHuman).supersedesId).toBe(EXISTING_ITEM_ID);
  });

  it('would fail if confirmation were ever wired to the tool arguments instead of the store', async () => {
    const base = assertTool.parse(MINIMAL_RAW);

    for (const variant of SMUGGLE_VARIANTS) {
      const fake = createStore({ actor: AGENT, existing: null });
      const forged = forge(base, variant.fields);
      const result = await runUnparsed(forged, fake, createTelemetry());

      expect(Object.keys(submittedItem(fake)), variant.label).not.toContain('humanConfirmed');
      expect(Object.keys(submittedItem(fake)), variant.label).not.toContain('assertedBy');
      expect(writtenOf(result).humanConfirmed, variant.label).toBe(false);
    }
  });

  it('holds the load-bearing gate even when parse is bypassed entirely', async () => {
    const base = assertTool.parse({ ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID });

    for (const variant of SMUGGLE_VARIANTS) {
      const fake = createStore({ actor: AGENT, existing: LOAD_BEARING_ITEM });
      const forged = forge(base, variant.fields);
      const result = await runUnparsed(forged, fake, createTelemetry());

      expect(statusOf(result), variant.label).toBe('pending_human_confirmation');
      expect(mutations(fake), variant.label).toEqual([]);
    }
  });
});

const SMUGGLED_INTO_HUMAN: readonly Smuggle[] = SMUGGLE_VARIANTS;
const LOAD_BEARING_FLAGS: readonly boolean[] = [false, true];
const SAME_ACTOR: readonly boolean[] = [false, true];

describe('GUARD (MNE-63, MNE-208) standing rule 1 on the mneia_assert path: an agent assertion never auto-supersedes a human-confirmed item, whatever the tool input claims', () => {
  it('returns pending and writes nothing across the whole generated input space, and this test is never weakened, skipped, or deleted', async () => {
    const attempted: string[] = [];
    const escapes: string[] = [];
    const wroteAnyway: string[] = [];
    const confirmed: string[] = [];

    for (const status of ITEM_STATUSES) {
      for (const loadBearing of LOAD_BEARING_FLAGS) {
        for (const sameActor of SAME_ACTOR) {
          for (const variant of SMUGGLED_INTO_HUMAN) {
            const existing = contextItem({
              status,
              humanConfirmed: true,
              loadBearing,
              assertedBy: sameActor ? AGENT_ACTOR_ID : OTHER_HUMAN_ACTOR_ID,
              supersededById: status === 'superseded' ? NEWER_ITEM_ID : null,
            });

            const label = [
              status,
              `lb=${loadBearing ? '1' : '0'}`,
              `same=${sameActor ? '1' : '0'}`,
              variant.label,
            ].join('|');
            attempted.push(label);

            const fake = createStore({ actor: AGENT, existing });
            const telemetry = createTelemetry();
            const result = await runTool(
              { ...FULL_RAW, ...variant.fields, supersedesId: EXISTING_ITEM_ID },
              fake,
              telemetry,
            );

            const outcome = statusOf(result);
            if (outcome === 'written') {
              escapes.push(label);
            } else if (outcome !== 'pending_human_confirmation') {
              confirmed.push(`${label} -> ${outcome}`);
            }

            if (mutations(fake).length > 0) {
              wroteAnyway.push(label);
            }

            expect(structuredOf(result).written, label).toBeNull();
            expect(telemetry.sink.saw('item.superseded'), label).toBe(false);
            expect(telemetry.sink.saw('checkpoint.item_extracted'), label).toBe(false);
          }
        }
      }
    }

    expect(attempted.length).toBeGreaterThan(0);
    expect(escapes).toEqual([]);
    expect(wroteAnyway).toEqual([]);
    expect(confirmed).toEqual([]);
  });

  it('routes the block to the pending queue rather than an error, so an agent can surface it', async () => {
    const fake = createStore({ actor: AGENT, existing: HUMAN_CONFIRMED_ITEM });
    const telemetry = createTelemetry();
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      telemetry,
    );

    expect(statusOf(result)).toBe('pending_human_confirmation');
    expect(result.isError).toBe(false);
    expect(structuredOf(result).pendingCount).toBe(1);

    const text = textOf(result);
    expect(text).toContain('PENDING HUMAN CONFIRMATION - nothing was written.');
    expect(text).toContain('human-confirmed');
    expect(text).toContain('§10.1 step 5');
    expect(text).toContain('surface this to a human');
    expect(text).toContain('do not route around it by asserting without supersedesId');
  });

  it('reaches the store only to read, in the exact order a reviewer can check', async () => {
    const fake = createStore({ actor: AGENT, existing: HUMAN_CONFIRMED_ITEM });
    await runTool({ ...FULL_RAW, supersedesId: EXISTING_ITEM_ID }, fake, createTelemetry());

    expect(fake.calls.map((call) => call.method)).toEqual(['getActor', 'getContextItem']);
  });

  it('carries no item body into the pending payload it hands back', async () => {
    const fake = createStore({ actor: AGENT, existing: HUMAN_CONFIRMED_ITEM });
    const result = await runTool(
      { ...FULL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      createTelemetry(),
    );

    const serialised = JSON.stringify(structuredOf(result)) + textOf(result);
    expect(serialised).not.toContain(EXISTING_BODY);
    expect(serialised).not.toContain(SECRET_BODY);
  });

  it('never hands the store a supersede the policy did not allow, because the store performs no check of its own', async () => {
    const blocked: readonly ContextItem[] = [
      contextItem({ humanConfirmed: true }),
      contextItem({ humanConfirmed: true, loadBearing: true }),
      contextItem({ humanConfirmed: true, status: 'disputed' }),
      contextItem({ humanConfirmed: true, supersededById: NEWER_ITEM_ID }),
      contextItem({ loadBearing: true }),
      contextItem({ status: 'disputed' }),
      contextItem({ status: 'retired' }),
      contextItem({ status: 'superseded', supersededById: NEWER_ITEM_ID }),
    ];

    for (const existing of blocked) {
      const fake = createStore({ actor: AGENT, existing });
      const result = await runTool(
        { ...FULL_RAW, supersedesId: EXISTING_ITEM_ID },
        fake,
        createTelemetry(),
      );

      const label = `${existing.status}|hc=${existing.humanConfirmed}|lb=${existing.loadBearing}`;
      expect(statusOf(result), label).not.toBe('written');
      expect(mutations(fake), label).toEqual([]);
    }
  });

  it('leaves an unrelated new assertion by the same agent untouched by the block', async () => {
    const fake = createStore({ actor: AGENT, existing: HUMAN_CONFIRMED_ITEM });
    const result = await runTool(MINIMAL_RAW, fake, createTelemetry());

    expect(statusOf(result)).toBe('written');
    expect(submittedItem(fake).supersedesId).toBeNull();
    expect(Object.keys(submittedItem(fake))).not.toContain('humanConfirmed');
    expect(fake.calls.map((call) => call.method)).toEqual(['getActor', 'writeCheckpoint']);
  });
});

describe('mneia_assert supersede arbitration', () => {
  it('rejects an unknown supersedesId and points at mneia_search', async () => {
    const fake = createStore({ existing: null });
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: UNKNOWN_ITEM_ID },
      fake,
      createTelemetry(),
    );

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('unknown_supersedes_id');
    expect(textOf(result)).toContain('mneia_search');
    expect(mutations(fake)).toEqual([]);
  });

  it('refuses to supersede across projects', async () => {
    const fake = createStore({ existing: contextItem({ projectId: OTHER_PROJECT_ID }) });
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      createTelemetry(),
    );

    expect(result.isError).toBe(true);
    expect(errorCodeOf(result)).toBe('project_mismatch');
    expect(structuredOf(result).error).toMatchObject({
      itemProjectId: OTHER_PROJECT_ID,
      projectId: PROJECT_ID,
    });
    expect(mutations(fake)).toEqual([]);
  });

  it('never auto-resolves a human versus human conflict', async () => {
    const fake = createStore({
      actor: HUMAN,
      existing: contextItem({ humanConfirmed: true, assertedBy: OTHER_HUMAN_ACTOR_ID }),
    });
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      createTelemetry(),
    );

    expect(statusOf(result)).toBe('pending_human_confirmation');
    expect(textOf(result)).toContain('§10.4');
    expect(mutations(fake)).toEqual([]);
  });

  it('lets a human supersede their own human-confirmed item', async () => {
    const fake = createStore({
      actor: HUMAN,
      existing: contextItem({ humanConfirmed: true, assertedBy: HUMAN_ACTOR_ID }),
    });
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      createTelemetry(),
    );

    expect(statusOf(result)).toBe('written');
    expect(submittedAction(fake)).toBe('superseded');
  });

  it('refuses a supersede aimed at a row that is no longer the head of its chain', async () => {
    const fake = createStore({
      actor: HUMAN,
      existing: contextItem({ supersededById: NEWER_ITEM_ID }),
    });
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      createTelemetry(),
    );

    expect(statusOf(result)).toBe('refused');
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('REFUSED - nothing was written.');
    expect(mutations(fake)).toEqual([]);
  });

  it('blocks superseding a disputed item behind its conflict record', async () => {
    const fake = createStore({ actor: HUMAN, existing: contextItem({ status: 'disputed' }) });
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      createTelemetry(),
    );

    expect(statusOf(result)).toBe('pending_human_confirmation');
    expect(mutations(fake)).toEqual([]);
  });
});

describe('mneia_assert writes', () => {
  it('attributes the write to a manual checkpoint owned by the scope actor', async () => {
    const fake = createStore({ existing: null });
    await runTool(FULL_RAW, fake, createTelemetry());

    expect(submittedCheckpoint(fake)).toEqual({
      projectId: PROJECT_ID,
      sessionId: SESSION_ID,
      actorId: AGENT_ACTOR_ID,
      trigger: 'manual',
      summary: null,
    });
    expect(submittedAction(fake)).toBe('created');
  });

  it('carries every caller-owned field through to the item unchanged', async () => {
    const fake = createStore({ existing: null });
    await runTool(FULL_RAW, fake, createTelemetry());

    expect(submittedItem(fake)).toEqual({
      projectId: PROJECT_ID,
      kind: 'decision',
      title: TITLE,
      body: SECRET_BODY,
      sourceSessionId: SESSION_ID,
      sourceRef: 'https://example.invalid/pr/42',
      confidence: 0.9,
      loadBearing: true,
      accessScope: 'team',
      supersedesId: null,
    });
  });

  it('reports the stored item so a client can correlate it', async () => {
    const fake = createStore({ existing: null });
    const result = await runTool(MINIMAL_RAW, fake, createTelemetry());

    expect(result.isError).toBeUndefined();
    expect(writtenOf(result)).toEqual({
      itemId: WRITTEN_ITEM_ID,
      checkpointId: CHECKPOINT_ID,
      kind: 'decision',
      title: TITLE,
      status: 'active',
      humanConfirmed: false,
      loadBearing: false,
      supersededItemId: null,
    });
    expect(structuredOf(result).pending).toEqual([]);
  });

  it('reports a missing actor as a re-authentication problem, not a write failure', async () => {
    const fake = createStore({ actor: null });
    const result = await runTool(MINIMAL_RAW, fake, createTelemetry());

    expect(errorCodeOf(result)).toBe('actor_not_found');
    expect(textOf(result)).toContain('Re-authenticate');
    expect(mutations(fake)).toEqual([]);
  });

  it('refuses to claim success when the store returns no written item', async () => {
    const fake = createStore({ existing: null, writeReturnsNothing: true });
    const telemetry = createTelemetry();
    const result = await runTool(MINIMAL_RAW, fake, telemetry);

    expect(errorCodeOf(result)).toBe('write_incomplete');
    expect(telemetry.sink.events).toEqual([]);
  });

  it('reports an unreachable store without pretending anything was recorded', async () => {
    const fake = createStore({ existing: null, failOn: 'writeCheckpoint' });
    const result = await runTool(MINIMAL_RAW, fake, createTelemetry());

    expect(errorCodeOf(result)).toBe('store_unavailable');
    expect(textOf(result)).toContain('Nothing was written');
    expect(textOf(result)).toContain('ECONNREFUSED');
  });

  it('reports an unreachable store during the actor lookup too', async () => {
    const fake = createStore({ failOn: 'getActor' });
    const result = await runTool(MINIMAL_RAW, fake, createTelemetry());

    expect(errorCodeOf(result)).toBe('store_unavailable');
  });
});

describe('mneia_assert telemetry', () => {
  it('emits a §17-valid checkpoint.item_extracted exactly once per write', async () => {
    const fake = createStore({ existing: null });
    const telemetry = createTelemetry();
    const result = await runTool(FULL_RAW, fake, telemetry);

    expect(telemetry.sink.names).toEqual(['checkpoint.item_extracted']);

    const event = telemetry.sink.lastOf('checkpoint.item_extracted');
    if (event === undefined) {
      throw new Error('expected a checkpoint.item_extracted event');
    }

    expect(event.workspaceId).toBe(WORKSPACE_ID);
    expect(event.projectId).toBe(PROJECT_ID);
    expect(event.actorId).toBe(AGENT_ACTOR_ID);
    expect(event.sessionId).toBe(SESSION_ID);
    expect(event.occurredAt).toEqual(NOW);
    expect(event.checkpointId).toBe(CHECKPOINT_ID);
    expect(event.itemId).toBe(writtenOf(result).itemId);
    expect(event.kind).toBe('decision');
    expect(event.confidence).toBe(0.9);
    expect(event.loadBearing).toBe(true);
    expect(event.trigger).toBe('manual');
  });

  it('emits item.superseded alongside the extraction when a supersede is allowed', async () => {
    const fake = createStore({
      actor: HUMAN,
      existing: contextItem({ humanConfirmed: true, assertedBy: HUMAN_ACTOR_ID }),
    });
    const telemetry = createTelemetry();
    const result = await runTool(
      { ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID },
      fake,
      telemetry,
    );

    expect(telemetry.sink.names).toEqual(['checkpoint.item_extracted', 'item.superseded']);

    const event = telemetry.sink.lastOf('item.superseded');
    if (event === undefined) {
      throw new Error('expected an item.superseded event');
    }
    expect(event.previousItemId).toBe(EXISTING_ITEM_ID);
    expect(event.nextItemId).toBe(writtenOf(result).itemId);
  });

  it('emits nothing at all when the assertion is blocked or rejected', async () => {
    const blocked = createStore({ actor: AGENT, existing: HUMAN_CONFIRMED_ITEM });
    const blockedTelemetry = createTelemetry();
    await runTool({ ...MINIMAL_RAW, supersedesId: EXISTING_ITEM_ID }, blocked, blockedTelemetry);
    expect(blockedTelemetry.raw).toEqual([]);

    const unknown = createStore({ existing: null });
    const unknownTelemetry = createTelemetry();
    await runTool({ ...MINIMAL_RAW, supersedesId: UNKNOWN_ITEM_ID }, unknown, unknownTelemetry);
    expect(unknownTelemetry.raw).toEqual([]);
  });

  it('carries no item body and no item title in any event it constructs', async () => {
    const fake = createStore({
      actor: HUMAN,
      existing: contextItem({ humanConfirmed: true, assertedBy: HUMAN_ACTOR_ID }),
    });
    const telemetry = createTelemetry();
    await runTool(
      { ...FULL_RAW, supersedesId: EXISTING_ITEM_ID, loadBearing: false },
      fake,
      telemetry,
    );

    expect(telemetry.raw.length).toBeGreaterThan(0);
    for (const event of telemetry.raw) {
      const serialised = JSON.stringify(event);
      expect(serialised).not.toContain(SECRET_BODY);
      expect(serialised).not.toContain(EXISTING_BODY);
      expect(serialised).not.toContain(TITLE);
      expect(serialised).not.toContain(EXISTING_TITLE);
      expect(serialised).not.toContain('sourceRef');
      expect(serialised).not.toContain('example.invalid');
    }
  });

  it('emits the §17 shape and nothing more, so the strict schema accepts it', async () => {
    const fake = createStore({ existing: null });
    const telemetry = createTelemetry();
    await runTool(FULL_RAW, fake, telemetry);

    const [raw] = telemetry.raw;
    if (raw === undefined) {
      throw new Error('expected the tool to construct an event');
    }

    expect(Object.keys(raw).sort()).toEqual(
      [
        'actorId',
        'checkpointId',
        'confidence',
        'itemId',
        'kind',
        'loadBearing',
        'name',
        'occurredAt',
        'projectId',
        'sessionId',
        'trigger',
        'workspaceId',
      ].sort(),
    );
    expect(telemetry.sink.countOf('checkpoint.item_extracted')).toBe(1);
  });

  it('still records the write when the telemetry sink rejects', async () => {
    const fake = createStore({ existing: null });
    const telemetry = createTelemetry({ sinkRejects: true });
    const result = await runTool(MINIMAL_RAW, fake, telemetry);

    expect(statusOf(result)).toBe('written');
    expect(telemetry.sink.events).toEqual([]);
    expect(telemetry.raw).toHaveLength(1);
  });

  it('still records the write when the emitter itself throws', async () => {
    const fake = createStore({ existing: null });
    const telemetry = createTelemetry({ emitterThrows: true });
    const result = await runTool(MINIMAL_RAW, fake, telemetry);

    expect(result.isError).toBeUndefined();
    expect(statusOf(result)).toBe('written');
    expect(writtenOf(result).itemId).toBe(WRITTEN_ITEM_ID);
  });
});
