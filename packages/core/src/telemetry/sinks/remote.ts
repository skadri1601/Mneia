import type { TelemetryEvent, TelemetrySink } from '../types.js';

export const REMOTE_ENDPOINT_ENV_VAR = 'MNEIA_TELEMETRY_ENDPOINT';
export const REMOTE_TOKEN_ENV_VAR = 'MNEIA_TELEMETRY_TOKEN';

export const DEFAULT_REMOTE_FLUSH_INTERVAL_MS = 5_000;
export const DEFAULT_REMOTE_BATCH_SIZE = 100;
export const DEFAULT_REMOTE_TIMEOUT_MS = 5_000;

export class TelemetryTransmitError extends Error {
  readonly endpoint: string;
  readonly lostEvents: number;

  constructor(
    message: string,
    details: { readonly endpoint: string; readonly lostEvents: number; readonly cause?: unknown },
  ) {
    super(message, { cause: details.cause });
    this.name = 'TelemetryTransmitError';
    this.endpoint = details.endpoint;
    this.lostEvents = details.lostEvents;
  }
}

export type FetchLike = (
  input: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
    readonly signal?: AbortSignal;
  },
) => Promise<{ readonly ok: boolean; readonly status: number }>;

export interface RemoteSinkOptions {
  readonly endpoint: string;
  readonly token?: string | undefined;
  readonly name?: string | undefined;
  readonly flushIntervalMs?: number | undefined;
  readonly batchSize?: number | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetch?: FetchLike | undefined;
  readonly onError?: ((error: TelemetryTransmitError) => void) | undefined;
}

export interface RemoteTelemetrySink extends TelemetrySink {
  readonly endpoint: string;
  readonly buffered: number;
}

export function createRemoteSink(options: RemoteSinkOptions): RemoteTelemetrySink {
  const endpoint = options.endpoint;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_REMOTE_FLUSH_INTERVAL_MS;
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_REMOTE_BATCH_SIZE);
  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_TIMEOUT_MS;
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const report = options.onError;

  let buffer: TelemetryEvent[] = [];
  let pending: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const notify = (error: TelemetryTransmitError): void => {
    if (report === undefined) {
      return;
    }
    queueMicrotask(() => {
      report(error);
    });
  };

  const transmit = async (batch: readonly TelemetryEvent[]): Promise<void> => {
    if (batch.length === 0) {
      return;
    }

    const controller = new AbortController();
    const abort = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (options.token !== undefined && options.token.length > 0) {
        headers.authorization = `Bearer ${options.token}`;
      }

      const response = await send(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ events: batch }),
        signal: controller.signal,
      });

      if (!response.ok) {
        notify(
          new TelemetryTransmitError(
            `${endpoint} rejected ${batch.length} telemetry event(s) with status ${response.status}`,
            { endpoint, lostEvents: batch.length },
          ),
        );
      }
    } catch (cause) {
      notify(
        new TelemetryTransmitError(
          `${endpoint} could not be reached; ${batch.length} telemetry event(s) were dropped`,
          { endpoint, lostEvents: batch.length, cause },
        ),
      );
    } finally {
      clearTimeout(abort);
    }
  };

  const drain = (): Promise<void> => {
    const batch = buffer;
    buffer = [];
    pending = pending.then(
      () => transmit(batch),
      () => transmit(batch),
    );
    return pending;
  };

  const startTimer = (): void => {
    if (timer !== null || closed) {
      return;
    }
    timer = setInterval(() => {
      void drain();
    }, flushIntervalMs);
    timer.unref?.();
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  return {
    name: options.name ?? 'remote',
    endpoint,

    get buffered(): number {
      return buffer.length;
    },

    async write(event: TelemetryEvent): Promise<void> {
      if (closed) {
        notify(
          new TelemetryTransmitError(
            `the remote telemetry sink for ${endpoint} is closed; 1 event was dropped`,
            { endpoint, lostEvents: 1 },
          ),
        );
        return;
      }
      buffer.push(event);
      startTimer();
      if (buffer.length >= batchSize) {
        await drain();
      }
    },

    async flush(): Promise<void> {
      await drain();
    },

    async close(): Promise<void> {
      closed = true;
      stopTimer();
      await drain();
    },
  };
}

export function remoteSinkFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  overrides: Omit<RemoteSinkOptions, 'endpoint' | 'token'> = {},
): RemoteTelemetrySink | null {
  const endpoint = env[REMOTE_ENDPOINT_ENV_VAR];
  if (endpoint === undefined || endpoint.trim().length === 0) {
    return null;
  }
  return createRemoteSink({ ...overrides, endpoint, token: env[REMOTE_TOKEN_ENV_VAR] });
}
