import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SINK_CONCURRENCY,
  TELEMETRY_ENV_VAR,
  TELEMETRY_OFF_VALUES,
  TelemetrySinkError,
  TelemetryValidationError,
  createNoopEmitter,
  createTelemetryEmitter,
  telemetryEnabledIn,
} from './emitter.js';
import { createMemorySink } from './sinks/memory.js';
import type { TelemetryEvent, TelemetrySink } from './types.js';

const occurredAt = new Date('2026-08-01T09:00:00.000Z');

const context = {
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  actorId: 'actor-1',
  sessionId: 'session-1',
  occurredAt,
} as const;

const sliceShown: TelemetryEvent = {
  name: 'rehydration.slice_shown',
  ...context,
  sliceId: 'slice-1',
  itemIds: ['item-1', 'item-2'],
  tokenBudget: 4000,
  tokensUsed: 1200,
  durationMs: 42,
};

const itemReferenced: TelemetryEvent = {
  name: 'rehydration.item_referenced',
  ...context,
  sliceId: 'slice-1',
  itemId: 'item-1',
};

const conflictResolved: TelemetryEvent = {
  name: 'conflict.resolved',
  ...context,
  conflictId: 'conflict-1',
  itemA: 'item-1',
  itemB: 'item-2',
  resolution: 'a_wins',
  resolvedBy: 'actor-1',
};

const malformed = (patch: Record<string, unknown>): TelemetryEvent =>
  ({ ...sliceShown, ...patch }) as TelemetryEvent;

const failingSink = (name: string, error: Error): TelemetrySink => ({
  name,
  write: () => Promise.reject(error),
  flush: () => Promise.reject(error),
  close: () => Promise.reject(error),
});

interface ErrorCollector {
  readonly errors: TelemetrySinkError[];
  readonly onError: (error: TelemetrySinkError) => void;
}

const collectErrors = (): ErrorCollector => {
  const errors: TelemetrySinkError[] = [];
  return {
    errors,
    onError: (error) => {
      errors.push(error);
    },
  };
};

describe('createTelemetryEmitter', () => {
  it('fans a single event out to every sink', async () => {
    const a = createMemorySink({ name: 'a' });
    const b = createMemorySink({ name: 'b' });
    const emitter = createTelemetryEmitter({ sinks: [a, b], env: {} });

    await emitter.emit(sliceShown);

    expect(a.events).toEqual([sliceShown]);
    expect(b.events).toEqual([sliceShown]);
  });

  it('preserves emission order per sink', async () => {
    const sink = createMemorySink();
    const emitter = createTelemetryEmitter({ sinks: [sink], env: {} });

    await emitter.emit(sliceShown);
    await emitter.emit(itemReferenced);
    await emitter.emit(conflictResolved);

    expect(sink.names).toEqual([
      'rehydration.slice_shown',
      'rehydration.item_referenced',
      'conflict.resolved',
    ]);
  });

  it('forwards flush and close to every sink', async () => {
    const sink = createMemorySink();
    const emitter = createTelemetryEmitter({ sinks: [sink], env: {} });

    await emitter.flush();
    await emitter.close();

    expect(sink.flushCount).toBe(1);
    expect(sink.closeCount).toBe(1);
  });
});

describe('validation', () => {
  it('throws synchronously so an unawaited emit still fails loudly', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });

    expect(() => emitter.emit(malformed({ tokensUsed: 'lots' }))).toThrow(TelemetryValidationError);
  });

  it('rejects an unknown event name', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });

    expect(() => emitter.emit(malformed({ name: 'rehydration.slice_showed' }))).toThrow(
      /unknown event name/,
    );
  });

  it('rejects a missing required field', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });

    expect(() => emitter.emit(malformed({ sliceId: undefined }))).toThrow(TelemetryValidationError);
  });

  it('rejects an empty id rather than writing a row that joins to nothing', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });

    expect(() => emitter.emit(malformed({ workspaceId: '' }))).toThrow(TelemetryValidationError);
  });

  it('rejects an enum value outside the schema', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });
    const bad = { ...conflictResolved, resolution: 'a_kinda_wins' } as TelemetryEvent;

    expect(() => emitter.emit(bad)).toThrow(TelemetryValidationError);
  });

  it('rejects an undeclared field so no event can widen without review', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });

    expect(() => emitter.emit(malformed({ experimentArm: 'b' }))).toThrow(/experimentArm/);
  });

  it('rejects an invalid Date', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });

    expect(() => emitter.emit(malformed({ occurredAt: new Date('not a date') }))).toThrow(
      TelemetryValidationError,
    );
  });

  it('writes nothing to any sink when validation fails', () => {
    const sink = createMemorySink();
    const emitter = createTelemetryEmitter({ sinks: [sink], env: {} });

    expect(() => emitter.emit(malformed({ tokensUsed: -1 }))).toThrow(TelemetryValidationError);
    expect(sink.events).toEqual([]);
  });

  it('names the event and the offending path in the message', () => {
    const emitter = createTelemetryEmitter({ sinks: [createMemorySink()], env: {} });

    try {
      emitter.emit(malformed({ tokensUsed: 'lots' }));
      expect.unreachable('expected a TelemetryValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(TelemetryValidationError);
      const failure = error as TelemetryValidationError;
      expect(failure.eventName).toBe('rehydration.slice_shown');
      expect(failure.issues.join(' ')).toContain('tokensUsed');
    }
  });
});

describe('sink error isolation', () => {
  it('does not let a throwing sink take down the write path', async () => {
    const healthy = createMemorySink({ name: 'healthy' });
    const { errors, onError } = collectErrors();
    const emitter = createTelemetryEmitter({
      sinks: [failingSink('broken', new Error('disk on fire')), healthy],
      onError,
      env: {},
    });

    await expect(emitter.emit(sliceShown)).resolves.toBeUndefined();

    expect(healthy.events).toEqual([sliceShown]);
    expect(errors).toHaveLength(1);
  });

  it('reports which sink, which operation, and which event failed', async () => {
    const { errors, onError } = collectErrors();
    const cause = new Error('disk on fire');
    const emitter = createTelemetryEmitter({
      sinks: [failingSink('broken', cause)],
      onError,
      env: {},
    });

    await emitter.emit(itemReferenced);

    const [failure] = errors;
    expect(failure).toBeInstanceOf(TelemetrySinkError);
    expect(failure?.sinkName).toBe('broken');
    expect(failure?.operation).toBe('write');
    expect(failure?.eventName).toBe('rehydration.item_referenced');
    expect(failure?.cause).toBe(cause);
  });

  it('isolates flush and close failures too', async () => {
    const healthy = createMemorySink({ name: 'healthy' });
    const { errors, onError } = collectErrors();
    const emitter = createTelemetryEmitter({
      sinks: [failingSink('broken', new Error('nope')), healthy],
      onError,
      env: {},
    });

    await expect(emitter.flush()).resolves.toBeUndefined();
    await expect(emitter.close()).resolves.toBeUndefined();

    expect(healthy.flushCount).toBe(1);
    expect(healthy.closeCount).toBe(1);
    expect(errors.map((error) => error.operation)).toEqual(['flush', 'close']);
  });

  it('swallows nothing — every failing sink is reported', async () => {
    const { errors, onError } = collectErrors();
    const emitter = createTelemetryEmitter({
      sinks: [
        failingSink('a', new Error('a')),
        failingSink('b', new Error('b')),
        failingSink('c', new Error('c')),
      ],
      onError,
      env: {},
    });

    await emitter.emit(sliceShown);

    expect(errors.map((error) => error.sinkName).sort()).toEqual(['a', 'b', 'c']);
  });

  it('still resolves when no onError handler is supplied', async () => {
    const emitter = createTelemetryEmitter({
      sinks: [failingSink('broken', new Error('nope'))],
      env: {},
    });

    await expect(emitter.emit(sliceShown)).resolves.toBeUndefined();
  });

  it('reports a sink that fails only for particular events', async () => {
    const { errors, onError } = collectErrors();
    const picky = createMemorySink({
      name: 'picky',
      fail: (event) => (event.name === 'conflict.resolved' ? new Error('refused') : null),
    });
    const emitter = createTelemetryEmitter({ sinks: [picky], onError, env: {} });

    await emitter.emit(sliceShown);
    await emitter.emit(conflictResolved);

    expect(picky.names).toEqual(['rehydration.slice_shown']);
    expect(errors).toHaveLength(1);
  });
});

describe('bounded fan-out', () => {
  it('never exceeds the configured concurrency', async () => {
    let inFlight = 0;
    let peak = 0;

    const slowSink = (name: string): TelemetrySink => ({
      name,
      write: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
      },
      flush: () => Promise.resolve(),
      close: () => Promise.resolve(),
    });

    const emitter = createTelemetryEmitter({
      sinks: Array.from({ length: 9 }, (_, index) => slowSink(`sink-${index}`)),
      concurrency: 2,
      env: {},
    });

    await emitter.emit(sliceShown);

    expect(peak).toBe(2);
  });

  it('reaches every sink even when the pool is narrower than the sink list', async () => {
    const sinks = Array.from({ length: 7 }, (_, index) => createMemorySink({ name: `s${index}` }));
    const emitter = createTelemetryEmitter({ sinks, concurrency: 2, env: {} });

    await emitter.emit(sliceShown);

    for (const sink of sinks) {
      expect(sink.events).toEqual([sliceShown]);
    }
  });

  it('defaults to a bounded pool rather than unbounded fan-out', () => {
    expect(DEFAULT_SINK_CONCURRENCY).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_SINK_CONCURRENCY)).toBe(true);
  });
});

describe('opt-out', () => {
  it('treats an unset variable as enabled', () => {
    expect(telemetryEnabledIn({})).toBe(true);
  });

  it('treats every documented off value as disabled, case and space insensitive', () => {
    for (const value of TELEMETRY_OFF_VALUES) {
      expect(telemetryEnabledIn({ [TELEMETRY_ENV_VAR]: value }), value).toBe(false);
      expect(telemetryEnabledIn({ [TELEMETRY_ENV_VAR]: ` ${value.toUpperCase()} ` })).toBe(false);
    }
  });

  it('treats any other value as enabled', () => {
    expect(telemetryEnabledIn({ [TELEMETRY_ENV_VAR]: 'on' })).toBe(true);
    expect(telemetryEnabledIn({ [TELEMETRY_ENV_VAR]: '1' })).toBe(true);
  });

  it('writes nothing when MNEIA_TELEMETRY is off', async () => {
    const sink = createMemorySink();
    const emitter = createTelemetryEmitter({
      sinks: [sink],
      env: { [TELEMETRY_ENV_VAR]: 'off' },
    });

    await emitter.emit(sliceShown);
    await emitter.emit(conflictResolved);

    expect(sink.events).toEqual([]);
  });

  it('does not throw on a malformed event when telemetry is off', () => {
    const emitter = createTelemetryEmitter({
      sinks: [createMemorySink()],
      env: { [TELEMETRY_ENV_VAR]: 'off' },
    });

    expect(() => emitter.emit(malformed({ tokensUsed: 'lots' }))).not.toThrow();
  });

  it('still releases sink resources on flush and close when disabled', async () => {
    const sink = createMemorySink();
    const emitter = createTelemetryEmitter({
      sinks: [sink],
      env: { [TELEMETRY_ENV_VAR]: 'off' },
    });

    await emitter.flush();
    await emitter.close();

    expect(sink.flushCount).toBe(1);
    expect(sink.closeCount).toBe(1);
  });

  it('lets an explicit enabled flag win over the environment', async () => {
    const sink = createMemorySink();
    const emitter = createTelemetryEmitter({
      sinks: [sink],
      enabled: true,
      env: { [TELEMETRY_ENV_VAR]: 'off' },
    });

    await emitter.emit(sliceShown);

    expect(sink.events).toEqual([sliceShown]);
  });

  it('exposes a no-op emitter with the identical shape', async () => {
    const emitter = createNoopEmitter();

    await expect(emitter.emit(sliceShown)).resolves.toBeUndefined();
    await expect(emitter.flush()).resolves.toBeUndefined();
    await expect(emitter.close()).resolves.toBeUndefined();
  });
});
