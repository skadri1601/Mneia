import type {
  Actor,
  CheckpointWrite,
  CheckpointWriteResult,
  ContextItem,
  ScopedStore,
  TelemetryEmitter,
  TelemetryEvent,
} from '@mneia/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiRequestError, handleWriteCheckpoint } from './handlers.js';

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const AGENT = '44444444-4444-4444-8444-444444444444';
const HUMAN = '55555555-5555-4555-8555-555555555555';
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
  accessScope: 'project',
  embedding: null,
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

  it('attributes the write to the token actor, not to anything in the payload', async () => {
    await handleWriteCheckpoint(
      sink.store,
      request({ assertedBy: IMPERSONATED, humanConfirmed: true }) as never,
      deps(sink.telemetry),
    );

    const write = sink.writes.at(0);
    expect(write?.checkpoint.actorId).toBe(AGENT);
    expect(write?.items.at(0)?.item.assertedBy).toBe(AGENT);
    expect(write?.items.at(0)?.item.assertedBy).not.toBe(IMPERSONATED);
  });

  it('derives human_confirmed from the actor kind read from the database', async () => {
    await handleWriteCheckpoint(
      sink.store,
      request({ humanConfirmed: true }) as never,
      deps(sink.telemetry),
    );

    expect(sink.writes.at(0)?.items.at(0)?.item.humanConfirmed).toBe(false);
  });

  it('marks a human actor human-confirmed without being asked to', async () => {
    const human = harness(actor(HUMAN, 'human'), [writtenItem({ assertedBy: HUMAN })]);

    await handleWriteCheckpoint(human.store, request() as never, deps(human.telemetry));

    expect(human.writes.at(0)?.items.at(0)?.item.humanConfirmed).toBe(true);
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
