import type {
  Actor,
  Checkpoint,
  CheckpointWrite,
  CheckpointWriteResult,
  ContextItem,
  ScopedStore,
  StaleContextItem,
  StaleContextItemFilter,
  TelemetryEmitter,
  TelemetryEvent,
  VerifyContextItemInput,
  VerifyContextItemResult,
} from '@mneia/core';
import { VerifyContextItemWireSchema } from '@mneia/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  handleListStaleItems,
  handleVerifyItem,
  handleWriteCheckpoint,
} from './handlers.js';

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';
const IMPERSONATED = '66666666-6666-4666-8666-666666666666';

const actor = (id: string, kind: Actor['kind']): Actor => ({
  id,
  workspaceId: WORKSPACE,
  kind,
  displayName: kind === 'human' ? 'Saad' : 'claude-code',
  externalRef: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
});

const writtenItem = (overrides: Partial<ContextItem> = {}): ContextItem => ({
  id: '77777777-7777-4777-8777-777777777777',
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  kind: 'decision',
  title: 'ship the hosted API',
  body: null,
  status: 'active',
  assertedBy: AGENT,
  assertedAt: new Date('2026-08-07T10:00:00.000Z'),
  sourceSessionId: null,
  sourceRef: null,
  confidence: 0.5,
  humanConfirmed: false,
  loadBearing: false,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: new Date('2026-08-07T10:00:00.000Z'),
  validTo: null,
  supersedesId: null,
  supersededById: null,
  supersedeReason: null,
  accessScope: 'project',
  embedding: null,
  embeddingModel: null,
  ...overrides,
});

interface Harness {
  readonly store: ScopedStore;
  readonly writes: CheckpointWrite[];
  readonly events: TelemetryEvent[];
  readonly telemetry: TelemetryEmitter;
}

const harness = (scopedActor: Actor | null, written: readonly ContextItem[]): Harness => {
  const writes: CheckpointWrite[] = [];
  const events: TelemetryEvent[] = [];

  const store = {
    scope: { workspaceId: WORKSPACE, actorId: scopedActor?.id ?? AGENT },
    getActor: async () => scopedActor,
    writeCheckpoint: async (write: CheckpointWrite): Promise<CheckpointWriteResult> => {
      writes.push(write);
      return {
        checkpoint: {
          id: '88888888-8888-4888-8888-888888888888',
          workspaceId: WORKSPACE,
          projectId: PROJECT,
          sessionId: null,
          actorId: write.checkpoint.actorId,
          trigger: write.checkpoint.trigger,
          createdAt: new Date('2026-08-07T10:00:00.000Z'),
          summary: write.checkpoint.summary ?? null,
        },
        items: [],
        written,
        conflicts: [],
      };
    },
  } as unknown as ScopedStore;

  const telemetry: TelemetryEmitter = {
    emit: async (event: TelemetryEvent) => {
      events.push(event);
    },
  } as unknown as TelemetryEmitter;

  return { store, writes, events, telemetry };
};

const deps = (telemetry: TelemetryEmitter) => ({
  telemetry,
  now: () => new Date('2026-08-07T10:00:00.000Z'),
});

const request = (extra: Record<string, unknown> = {}) => ({
  checkpoint: { projectId: PROJECT, sessionId: null, trigger: 'manual' as const, summary: null },
  items: [
    {
      action: 'created' as const,
      item: {
        projectId: PROJECT,
        kind: 'decision' as const,
        title: 'ship the hosted API',
        ...extra,
      },
    },
  ],
});

describe('handleWriteCheckpoint provenance', () => {
  let sink: Harness;

  beforeEach(() => {
    sink = harness(actor(AGENT, 'agent'), [writtenItem()]);
  });

  it('hands the store no provenance at all, so the store is the only thing that decides', async () => {
    await handleWriteCheckpoint(
      sink.store,
      request({ assertedBy: IMPERSONATED, humanConfirmed: true }) as never,
      deps(sink.telemetry),
    );

    const item = sink.writes.at(0)?.items.at(0)?.item;
    expect(item).toBeDefined();
    expect(Object.keys(item ?? {})).not.toContain('assertedBy');
    expect(Object.keys(item ?? {})).not.toContain('humanConfirmed');
    expect(JSON.stringify(item)).not.toContain(IMPERSONATED);
  });

  it('attributes the checkpoint itself to the token actor', async () => {
    await handleWriteCheckpoint(
      sink.store,
      request({ assertedBy: IMPERSONATED }) as never,
      deps(sink.telemetry),
    );

    expect(sink.writes.at(0)?.checkpoint.actorId).toBe(AGENT);
  });

  it('refuses the write when the token names an actor that no longer exists', async () => {
    const orphaned = harness(null, []);

    await expect(
      handleWriteCheckpoint(orphaned.store, request() as never, deps(orphaned.telemetry)),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(orphaned.writes).toHaveLength(0);
  });
});

describe('handleWriteCheckpoint telemetry', () => {
  it('emits checkpoint.item_extracted for every item it writes', async () => {
    const sink = harness(actor(AGENT, 'agent'), [writtenItem()]);

    await handleWriteCheckpoint(sink.store, request() as never, deps(sink.telemetry));

    const extracted = sink.events.filter((event) => event.name === 'checkpoint.item_extracted');
    expect(extracted).toHaveLength(1);
    expect(extracted.at(0)).toMatchObject({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      actorId: AGENT,
      trigger: 'manual',
    });
  });

  it('copies echoed extraction coverage onto every item it emits', async () => {
    const sink = harness(actor(AGENT, 'agent'), [writtenItem(), writtenItem()]);
    const coverage = {
      droppedTurns: 0,
      splitTurns: 3,
      pendingTurns: 40,
      consumedTurns: 12,
      incompleteCode: 'provider_failed' as const,
    };

    const withCoverage = {
      ...request(),
      checkpoint: { ...request().checkpoint, coverage },
    };

    await handleWriteCheckpoint(sink.store, withCoverage as never, deps(sink.telemetry));

    const extracted = sink.events.filter((event) => event.name === 'checkpoint.item_extracted');
    expect(extracted.length).toBeGreaterThan(0);
    for (const event of extracted) {
      expect(event).toMatchObject({ coverage });
    }
  });

  it('leaves coverage absent when the client does not echo it, rather than inventing zeroes', async () => {
    const sink = harness(actor(AGENT, 'agent'), [writtenItem()]);

    await handleWriteCheckpoint(sink.store, request() as never, deps(sink.telemetry));

    const extracted = sink.events.filter((event) => event.name === 'checkpoint.item_extracted');
    expect(extracted.at(0)).not.toHaveProperty('coverage', expect.anything());
  });

  it('emits item.superseded when the written item replaces one', async () => {
    const previous = '99999999-9999-4999-8999-999999999999';
    const sink = harness(actor(AGENT, 'agent'), [writtenItem({ supersedesId: previous })]);

    await handleWriteCheckpoint(sink.store, request() as never, deps(sink.telemetry));

    expect(sink.events.filter((event) => event.name === 'item.superseded').at(0)).toMatchObject({
      previousItemId: previous,
      nextItemId: writtenItem().id,
    });
  });

  it('does not emit item.superseded for a plain creation', async () => {
    const sink = harness(actor(AGENT, 'agent'), [writtenItem()]);

    await handleWriteCheckpoint(sink.store, request() as never, deps(sink.telemetry));

    expect(sink.events.some((event) => event.name === 'item.superseded')).toBe(false);
  });
});

describe('handleWriteCheckpoint embeddings', () => {
  const EMBEDDING = Array.from({ length: 1536 }, () => 0.1);

  const provider = (
    embed: (texts: readonly string[]) => Promise<readonly (readonly number[])[]>,
  ) => ({
    model: 'openai:text-embedding-3-small',
    dimensions: 1536,
    embed,
  });

  it('stores the vector alongside the model that produced it', async () => {
    const sink = harness(actor(AGENT, 'agent'), [writtenItem()]);

    await handleWriteCheckpoint(sink.store, request() as never, {
      ...deps(sink.telemetry),
      embeddings: provider(async (texts) => texts.map(() => EMBEDDING)),
    });

    const item = sink.writes[0]?.items[0]?.item;
    expect(item?.embedding).toHaveLength(1536);
    expect(item?.embeddingModel).toBe('openai:text-embedding-3-small');
  });

  it('still writes the item when the embedding provider fails, rather than losing the work', async () => {
    const sink = harness(actor(AGENT, 'agent'), [writtenItem()]);

    await handleWriteCheckpoint(sink.store, request() as never, {
      ...deps(sink.telemetry),
      embeddings: provider(async () => {
        throw new Error('the embedding provider is down');
      }),
    });

    const item = sink.writes[0]?.items[0]?.item;
    expect(item?.embedding).toBeNull();
    expect(item?.embeddingModel).toBeNull();
    expect(sink.events.some((event) => event.name === 'checkpoint.item_extracted')).toBe(true);
  });

  it('writes a null vector when no provider is configured', async () => {
    const sink = harness(actor(AGENT, 'agent'), [writtenItem()]);

    await handleWriteCheckpoint(sink.store, request() as never, {
      ...deps(sink.telemetry),
      embeddings: null,
    });

    expect(sink.writes[0]?.items[0]?.item.embedding).toBeNull();
  });
});

const HUMAN = '99999999-9999-4999-8999-999999999999';
const CHECKPOINT = '88888888-8888-4888-8888-888888888888';
const ITEM = '77777777-7777-4777-8777-777777777777';
const NOW = new Date('2026-08-07T10:00:00.000Z');

const verificationCheckpoint: Checkpoint = {
  id: CHECKPOINT,
  workspaceId: WORKSPACE,
  projectId: PROJECT,
  sessionId: null,
  actorId: HUMAN,
  trigger: 'manual',
  createdAt: NOW,
  summary: 'Re-verified: still holds',
};

interface VerifyHarness {
  readonly store: ScopedStore;
  readonly calls: VerifyContextItemInput[];
  readonly events: TelemetryEvent[];
  readonly telemetry: TelemetryEmitter;
}

const verifyHarness = (verification: VerifyContextItemResult['verification']): VerifyHarness => {
  const calls: VerifyContextItemInput[] = [];
  const events: TelemetryEvent[] = [];

  const store = {
    scope: { workspaceId: WORKSPACE, actorId: HUMAN },
    verifyContextItem: async (input: VerifyContextItemInput): Promise<VerifyContextItemResult> => {
      calls.push(input);
      return {
        checkpoint: verificationCheckpoint,
        item: writtenItem({
          id: ITEM,
          humanConfirmed: verification === 'confirmed',
          status: verification === 'confirmed' ? 'active' : 'retired',
          lastVerifiedAt: NOW,
          body: 'the rationale nobody may leak',
        }),
        verification,
        previousLastVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
      };
    },
  } as unknown as ScopedStore;

  const telemetry = {
    emit: async (event: TelemetryEvent) => {
      events.push(event);
    },
  } as unknown as TelemetryEmitter;

  return { store, calls, events, telemetry };
};

describe('handleVerifyItem', () => {
  it('emits checkpoint.item_confirmed when the human says the item still holds', async () => {
    const sink = verifyHarness('confirmed');

    await handleVerifyItem(
      sink.store,
      { projectId: PROJECT, itemId: ITEM, verification: 'confirmed' },
      deps(sink.telemetry),
    );

    expect(sink.events.map((event) => event.name)).toEqual(['checkpoint.item_confirmed']);
    expect(sink.events[0]).toMatchObject({
      workspaceId: WORKSPACE,
      projectId: PROJECT,
      actorId: HUMAN,
      checkpointId: CHECKPOINT,
      itemId: ITEM,
    });
  });

  it('emits checkpoint.item_rejected when the human denies it', async () => {
    const sink = verifyHarness('denied');

    await handleVerifyItem(
      sink.store,
      { projectId: PROJECT, itemId: ITEM, verification: 'denied', reason: 'we moved off Redis' },
      deps(sink.telemetry),
    );

    expect(sink.events.map((event) => event.name)).toEqual(['checkpoint.item_rejected']);
  });

  it('carries no item body into the event payload', async () => {
    const sink = verifyHarness('confirmed');

    await handleVerifyItem(
      sink.store,
      { projectId: PROJECT, itemId: ITEM, verification: 'confirmed' },
      deps(sink.telemetry),
    );

    expect(JSON.stringify(sink.events)).not.toContain('the rationale nobody may leak');
  });

  it('refuses a denial with no reason, before touching the store', async () => {
    const sink = verifyHarness('denied');

    await expect(
      handleVerifyItem(
        sink.store,
        { projectId: PROJECT, itemId: ITEM, verification: 'denied', reason: '   ' },
        deps(sink.telemetry),
      ),
    ).rejects.toBeInstanceOf(ApiRequestError);

    expect(sink.calls).toEqual([]);
    expect(sink.events).toEqual([]);
  });

  it('drops humanConfirmed and assertedBy at the schema, before the handler ever sees them', () => {
    const parsed = VerifyContextItemWireSchema.parse({
      projectId: PROJECT,
      itemId: ITEM,
      verification: 'confirmed',
      humanConfirmed: true,
      assertedBy: IMPERSONATED,
    });

    expect(parsed).toEqual({ projectId: PROJECT, itemId: ITEM, verification: 'confirmed' });
  });

  it('passes only projectId, itemId, verification and reason to the store', async () => {
    const sink = verifyHarness('confirmed');

    const smuggled = {
      projectId: PROJECT,
      itemId: ITEM,
      verification: 'confirmed',
      humanConfirmed: true,
      assertedBy: IMPERSONATED,
    } as unknown as Parameters<typeof handleVerifyItem>[1];

    await handleVerifyItem(sink.store, smuggled, deps(sink.telemetry));

    expect(sink.calls[0]).toEqual({
      projectId: PROJECT,
      itemId: ITEM,
      verification: 'confirmed',
      reason: null,
    });
  });

  it('returns the wire result, with the previous verification instant as an ISO string', async () => {
    const sink = verifyHarness('confirmed');

    const result = await handleVerifyItem(
      sink.store,
      { projectId: PROJECT, itemId: ITEM, verification: 'confirmed' },
      deps(sink.telemetry),
    );

    expect(result.verification).toBe('confirmed');
    expect(result.previousLastVerifiedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(result.checkpoint.id).toBe(CHECKPOINT);
    expect(result.item.id).toBe(ITEM);
  });

  it('still returns the result when the telemetry sink throws', async () => {
    const sink = verifyHarness('confirmed');
    const failing = {
      emit: async () => {
        throw new Error('sink is down');
      },
    } as unknown as TelemetryEmitter;

    const result = await handleVerifyItem(
      sink.store,
      { projectId: PROJECT, itemId: ITEM, verification: 'confirmed' },
      deps(failing),
    );

    expect(result.checkpoint.id).toBe(CHECKPOINT);
  });
});

describe('handleListStaleItems', () => {
  const staleHarness = (stale: readonly StaleContextItem[]) => {
    const filters: StaleContextItemFilter[] = [];
    const store = {
      scope: { workspaceId: WORKSPACE, actorId: HUMAN },
      listStaleContextItems: async (filter: StaleContextItemFilter) => {
        filters.push(filter);
        return stale;
      },
    } as unknown as ScopedStore;
    return { store, filters };
  };

  it('encodes staleSince as an ISO string and keeps staleForMs', async () => {
    const sink = staleHarness([
      {
        item: writtenItem({ id: ITEM }),
        staleSince: new Date('2026-08-01T00:00:00.000Z'),
        staleForMs: 518_400_000,
      },
    ]);

    const { items } = await handleListStaleItems(sink.store, { projectId: PROJECT });

    expect(items[0]?.staleSince).toBe('2026-08-01T00:00:00.000Z');
    expect(items[0]?.staleForMs).toBe(518_400_000);
    expect(items[0]?.item.id).toBe(ITEM);
  });

  it('decodes asOf into a Date and forwards the limit', async () => {
    const sink = staleHarness([]);

    await handleListStaleItems(sink.store, {
      projectId: PROJECT,
      asOf: '2026-08-07T10:00:00.000Z',
      limit: 25,
    });

    expect(sink.filters[0]).toEqual({ projectId: PROJECT, asOf: NOW, limit: 25 });
  });

  it('omits asOf and limit entirely when the caller sent neither', async () => {
    const sink = staleHarness([]);

    await handleListStaleItems(sink.store, { projectId: PROJECT });

    expect(sink.filters[0]).toEqual({ projectId: PROJECT });
  });
});
