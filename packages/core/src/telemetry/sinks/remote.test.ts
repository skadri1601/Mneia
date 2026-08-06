import { describe, expect, it } from 'vitest';
import { createTelemetryEmitter } from '../emitter.js';
import type { TelemetryEvent } from '../types.js';
import type { FetchLike, TelemetryTransmitError } from './remote.js';
import { createRemoteSink, REMOTE_ENDPOINT_ENV_VAR, remoteSinkFromEnv } from './remote.js';

const ENDPOINT = 'https://telemetry.example.test/v1/events';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

function sliceShown(sliceId: string): TelemetryEvent {
  return {
    name: 'rehydration.slice_shown',
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    actorId: ACTOR_ID,
    sessionId: null,
    occurredAt: new Date('2026-08-05T12:00:00.000Z'),
    sliceId,
    itemIds: [],
    tokenBudget: 4000,
    tokensUsed: 0,
    durationMs: 12,
  } as TelemetryEvent;
}

interface Recorder {
  readonly calls: { url: string; headers: Record<string, string>; body: string }[];
  readonly fetch: FetchLike;
}

function recorder(ok = true, status = 202): Recorder {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return Promise.resolve({ ok, status });
    },
  };
}

describe('remoteSinkFromEnv', () => {
  it('is off until the endpoint is set, which is the whole point of opt-in', () => {
    expect(remoteSinkFromEnv({})).toBeNull();
    expect(remoteSinkFromEnv({ [REMOTE_ENDPOINT_ENV_VAR]: '' })).toBeNull();
    expect(remoteSinkFromEnv({ [REMOTE_ENDPOINT_ENV_VAR]: '   ' })).toBeNull();
  });

  it('is on once the endpoint is set', () => {
    const sink = remoteSinkFromEnv({ [REMOTE_ENDPOINT_ENV_VAR]: ENDPOINT });
    expect(sink?.endpoint).toBe(ENDPOINT);
  });
});

describe('createRemoteSink', () => {
  it('sends nothing until flushed, then posts one batch', async () => {
    const spy = recorder();
    const sink = createRemoteSink({ endpoint: ENDPOINT, fetch: spy.fetch, batchSize: 100 });

    await sink.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000001'));
    await sink.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000002'));
    expect(spy.calls).toHaveLength(0);
    expect(sink.buffered).toBe(2);

    await sink.flush();

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.url).toBe(ENDPOINT);
    const payload: unknown = JSON.parse(spy.calls[0]?.body ?? '{}');
    expect(Reflect.get(payload as object, 'events')).toHaveLength(2);
    await sink.close();
  });

  it('posts as soon as the batch is full, without waiting for the timer', async () => {
    const spy = recorder();
    const sink = createRemoteSink({ endpoint: ENDPOINT, fetch: spy.fetch, batchSize: 2 });

    await sink.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000001'));
    expect(spy.calls).toHaveLength(0);
    await sink.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000002'));

    expect(spy.calls).toHaveLength(1);
    await sink.close();
  });

  it('carries the token as a bearer header only when one is configured', async () => {
    const withToken = recorder();
    const withoutToken = recorder();

    const a = createRemoteSink({ endpoint: ENDPOINT, token: 'secret', fetch: withToken.fetch });
    await a.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000001'));
    await a.flush();

    const b = createRemoteSink({ endpoint: ENDPOINT, fetch: withoutToken.fetch });
    await b.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000001'));
    await b.flush();

    expect(withToken.calls[0]?.headers.authorization).toBe('Bearer secret');
    expect(withoutToken.calls[0]?.headers.authorization).toBeUndefined();
    await Promise.all([a.close(), b.close()]);
  });

  it('reports a rejected batch rather than swallowing it', async () => {
    const errors: TelemetryTransmitError[] = [];
    const spy = recorder(false, 503);
    const sink = createRemoteSink({
      endpoint: ENDPOINT,
      fetch: spy.fetch,
      onError: (error) => {
        errors.push(error);
      },
    });

    await sink.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000001'));
    await sink.flush();
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]?.lostEvents).toBe(1);
    expect(errors[0]?.message).toContain('503');
    await sink.close();
  });

  it('reports an unreachable endpoint rather than throwing into the caller', async () => {
    const errors: TelemetryTransmitError[] = [];
    const sink = createRemoteSink({
      endpoint: ENDPOINT,
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
      onError: (error) => {
        errors.push(error);
      },
    });

    await expect(
      sink.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000001')),
    ).resolves.toBeUndefined();
    await sink.flush();
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });

    expect(errors[0]?.message).toContain('could not be reached');
    await sink.close();
  });

  it('drops writes after close, and says so', async () => {
    const errors: TelemetryTransmitError[] = [];
    const spy = recorder();
    const sink = createRemoteSink({
      endpoint: ENDPOINT,
      fetch: spy.fetch,
      onError: (error) => {
        errors.push(error);
      },
    });

    await sink.close();
    await sink.write(sliceShown('aaaaaaa1-0000-4000-8000-000000000001'));
    await new Promise((resolve) => {
      queueMicrotask(() => resolve(undefined));
    });

    expect(errors[0]?.message).toContain('is closed');
  });
});

describe('GUARD (MNE-50) no item body reaches the one sink that leaves the machine', () => {
  const SENTINEL = 'SENTINEL-BODY-4f2ab9-must-never-be-transmitted';

  it('strips a body-like field from every event before it is posted', async () => {
    const spy = recorder();
    const sink = createRemoteSink({ endpoint: ENDPOINT, fetch: spy.fetch, batchSize: 1000 });
    const emitter = createTelemetryEmitter({ sinks: [sink], enabled: true });

    const widened = {
      ...sliceShown('aaaaaaa1-0000-4000-8000-000000000001'),
      body: SENTINEL,
      title: SENTINEL,
      summary: SENTINEL,
    } as unknown as TelemetryEvent;

    await emitter.emit(widened);

    await sink.flush();

    expect(spy.calls).toHaveLength(1);
    for (const call of spy.calls) {
      expect(call.body).not.toContain(SENTINEL);
    }
    expect(spy.calls[0]?.body).toContain('rehydration.slice_shown');
    await sink.close();
  });
});
