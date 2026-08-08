import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTelemetryEmitter, TELEMETRY_ENV_VAR } from './emitter.js';
import { isRedactedKey } from './redact.js';
import { createJsonlSink } from './sinks/jsonl.js';
import { createMemorySink } from './sinks/memory.js';
import type { TelemetryEvent, TelemetryEventName } from './types.js';
import { TELEMETRY_EVENT_NAMES } from './types.js';

const SENTINEL = 'SENTINEL-BODY-4f2ab9-must-never-reach-a-sink';

const occurredAt = new Date('2026-08-01T09:00:00.000Z');

const context = {
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  actorId: 'actor-1',
  sessionId: 'session-1',
  occurredAt,
} as const;

const FIXTURES: Record<TelemetryEventName, TelemetryEvent> = {
  'rehydration.slice_shown': {
    name: 'rehydration.slice_shown',
    ...context,
    sliceId: 'slice-1',
    itemIds: ['item-1', 'item-2'],
    tokenBudget: 4000,
    tokensUsed: 1200,
    durationMs: 42,
  },
  'rehydration.item_referenced': {
    name: 'rehydration.item_referenced',
    ...context,
    sliceId: 'slice-1',
    itemId: 'item-1',
  },
  'rehydration.item_ignored': {
    name: 'rehydration.item_ignored',
    ...context,
    sessionId: null,
    sliceId: 'slice-1',
    itemId: 'item-2',
  },
  'checkpoint.item_extracted': {
    name: 'checkpoint.item_extracted',
    ...context,
    checkpointId: 'cp-1',
    itemId: 'item-1',
    kind: 'decision',
    confidence: 0.82,
    loadBearing: true,
    trigger: 'task_boundary',
  },
  'checkpoint.item_confirmed': {
    name: 'checkpoint.item_confirmed',
    ...context,
    checkpointId: 'cp-1',
    itemId: 'item-1',
  },
  'checkpoint.item_edited': {
    name: 'checkpoint.item_edited',
    ...context,
    checkpointId: 'cp-1',
    itemId: 'item-1',
    fieldsChanged: ['body', 'loadBearing'],
  },
  'checkpoint.item_rejected': {
    name: 'checkpoint.item_rejected',
    ...context,
    checkpointId: 'cp-1',
    itemId: 'item-3',
  },
  'conflict.detected': {
    name: 'conflict.detected',
    ...context,
    conflictId: 'conflict-1',
    itemA: 'item-1',
    itemB: 'item-2',
    loadBearing: true,
  },
  'conflict.resolved': {
    name: 'conflict.resolved',
    ...context,
    conflictId: 'conflict-1',
    itemA: 'item-1',
    itemB: 'item-2',
    resolution: 'a_wins',
    resolvedBy: 'actor-1',
  },
  'item.superseded': {
    name: 'item.superseded',
    ...context,
    previousItemId: 'item-1',
    nextItemId: 'item-9',
  },
  'handoff.created': {
    name: 'handoff.created',
    ...context,
    handoffId: 'handoff-1',
    itemIds: ['item-1', 'item-2'],
    toActor: null,
  },
  'handoff.received': {
    name: 'handoff.received',
    ...context,
    handoffId: 'handoff-1',
    receivedBy: 'actor-2',
  },
  'handoff.time_to_first_action': {
    name: 'handoff.time_to_first_action',
    ...context,
    handoffId: 'handoff-1',
    elapsedMs: 91_000,
  },
};

const FLAT_BODY_FIELDS: Record<string, unknown> = {
  body: SENTINEL,
  content: SENTINEL,
  text: SENTINEL,
  title: SENTINEL,
  summary: SENTINEL,
  prompt: SENTINEL,
  completion: SENTINEL,
  transcript: SENTINEL,
  conversation: SENTINEL,
  rendered: SENTINEL,
  nextAction: SENTINEL,
  next_action: SENTINEL,
  itemBody: SENTINEL,
  item_body: SENTINEL,
  description: SENTINEL,
  rationale: SENTINEL,
  reason: SENTINEL,
  snippet: SENTINEL,
  diff: SENTINEL,
  rawText: SENTINEL,
};

const NESTED_BODY_FIELDS: Record<string, unknown> = {
  item: { id: 'item-1', body: SENTINEL },
  items: [
    { id: 'item-1', content: SENTINEL },
    { id: 'item-2', summary: SENTINEL },
  ],
  slice: { packed: { transcript: SENTINEL } },
};

const widen = (event: TelemetryEvent, extras: Record<string, unknown>): TelemetryEvent =>
  ({ ...event, ...extras }) as unknown as TelemetryEvent;

const fixtures = (): readonly [TelemetryEventName, TelemetryEvent][] =>
  TELEMETRY_EVENT_NAMES.map((name) => [name, FIXTURES[name]]);

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, into);
    }
    return;
  }
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    into.add(key);
    collectKeys(entry, into);
  }
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : String(error);

describe('MNE-50 invariant: no item body reaches a telemetry sink', () => {
  it('covers every event name in TELEMETRY_EVENT_NAMES', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([...TELEMETRY_EVENT_NAMES].sort());

    for (const [name, event] of fixtures()) {
      expect(event.name, `fixture for ${name} is mislabelled`).toBe(name);
    }
  });

  it('declares no body-like field on any event, at any depth', () => {
    for (const [name, event] of fixtures()) {
      const keys = new Set<string>();
      collectKeys(event, keys);

      for (const key of keys) {
        expect(isRedactedKey(key), `${name} declares a body-like field "${key}"`).toBe(false);
      }
    }
  });

  it('strips a body-like field a widened type would introduce, for every event', async () => {
    for (const [name, event] of fixtures()) {
      const sink = createMemorySink();
      const emitter = createTelemetryEmitter({ sinks: [sink], env: {} });

      await emitter.emit(widen(event, FLAT_BODY_FIELDS));

      expect(sink.events, `${name} was dropped instead of written`).toHaveLength(1);
      expect(JSON.stringify(sink.events), `${name} leaked a body to its sink`).not.toContain(
        SENTINEL,
      );
    }
  });

  it('never lets a nested body reach a sink or an error message, for every event', async () => {
    for (const [name, event] of fixtures()) {
      const sink = createMemorySink();
      const emitter = createTelemetryEmitter({ sinks: [sink], env: {} });

      try {
        await emitter.emit(widen(event, NESTED_BODY_FIELDS));
      } catch (error) {
        expect(messageOf(error), `${name} leaked a body into its error`).not.toContain(SENTINEL);
      }

      expect(JSON.stringify(sink.events), `${name} leaked a nested body to its sink`).not.toContain(
        SENTINEL,
      );
    }
  });

  it('refuses any undeclared field, so the sink surface is exactly the declared surface', () => {
    for (const [name, event] of fixtures()) {
      const sink = createMemorySink();
      const emitter = createTelemetryEmitter({ sinks: [sink], env: {} });

      expect(
        () => emitter.emit(widen(event, { experimentArm: 'b' })),
        `${name} accepted an undeclared field`,
      ).toThrow(/experimentArm/);
      expect(sink.events).toHaveLength(0);
    }
  });

  it('keeps the sentinel out of the bytes a file sink writes to disk', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mneia-privacy-'));
    const filePath = join(directory, 'telemetry.jsonl');

    try {
      const sink = createJsonlSink({ filePath, flushIntervalMs: 0 });
      const emitter = createTelemetryEmitter({ sinks: [sink], env: {} });

      for (const [, event] of fixtures()) {
        await emitter.emit(widen(event, FLAT_BODY_FIELDS));
      }
      await emitter.close();

      const written = await readFile(filePath, 'utf8');
      const lines = written.split('\n').filter((line) => line.length > 0);

      expect(lines).toHaveLength(TELEMETRY_EVENT_NAMES.length);
      expect(written).not.toContain(SENTINEL);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('MNE-50: telemetry is opt-out', () => {
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'mneia-privacy-optout-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('writes nothing anywhere when MNEIA_TELEMETRY is off', async () => {
    const filePath = join(directory, 'telemetry.jsonl');
    const memory = createMemorySink();
    const file = createJsonlSink({ filePath, flushIntervalMs: 0 });
    const emitter = createTelemetryEmitter({
      sinks: [memory, file],
      env: { [TELEMETRY_ENV_VAR]: 'off' },
    });

    for (const [, event] of fixtures()) {
      await emitter.emit(event);
    }
    await emitter.close();

    expect(memory.events).toEqual([]);
    await expect(readFile(filePath, 'utf8')).rejects.toThrow();
  });
});
