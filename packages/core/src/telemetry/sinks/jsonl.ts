import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TelemetryEvent, TelemetrySink } from '../types.js';

export const DEFAULT_FLUSH_INTERVAL_MS = 1_000;

export const DEFAULT_MAX_BUFFERED_EVENTS = 500;

export class TelemetryWriteError extends Error {
  readonly filePath: string;
  readonly lostEvents: number;

  constructor(
    message: string,
    details: { readonly filePath: string; readonly lostEvents: number; readonly cause?: unknown },
  ) {
    super(message, { cause: details.cause });
    this.name = 'TelemetryWriteError';
    this.filePath = details.filePath;
    this.lostEvents = details.lostEvents;
  }
}

export interface JsonlSinkOptions {
  readonly filePath: string;
  readonly name?: string | undefined;
  readonly flushIntervalMs?: number | undefined;
  readonly maxBufferedEvents?: number | undefined;
  readonly onError?: ((error: TelemetryWriteError) => void) | undefined;
}

export interface JsonlTelemetrySink extends TelemetrySink {
  readonly filePath: string;
  readonly buffered: number;
}

export function createJsonlSink(options: JsonlSinkOptions): JsonlTelemetrySink {
  const filePath = options.filePath;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  const maxBufferedEvents = Math.max(1, options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS);
  const report = options.onError;

  let buffer: string[] = [];
  let pending: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let directoryReady: Promise<void> | null = null;
  let closed = false;

  const notify = (error: TelemetryWriteError): void => {
    if (report === undefined) {
      return;
    }
    queueMicrotask(() => {
      report(error);
    });
  };

  const ensureDirectory = async (): Promise<void> => {
    directoryReady ??= mkdir(dirname(filePath), { recursive: true }).then(() => undefined);
    await directoryReady;
  };

  const drain = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }

    const lines = buffer;
    buffer = [];

    try {
      await ensureDirectory();
      await appendFile(filePath, `${lines.join('\n')}\n`, 'utf8');
    } catch (cause) {
      directoryReady = null;
      notify(
        new TelemetryWriteError(
          `telemetry sink could not append ${lines.length} event(s) to ${filePath}; those events are lost — check the path exists and is writable`,
          { filePath, lostEvents: lines.length, cause },
        ),
      );
    }
  };

  const enqueueDrain = (): Promise<void> => {
    const next = pending.then(drain, drain);
    pending = next;
    return next;
  };

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const startTimer = (): void => {
    if (timer !== null || closed || flushIntervalMs <= 0) {
      return;
    }
    timer = setInterval(() => {
      void enqueueDrain();
    }, flushIntervalMs);
    timer.unref();
  };

  return {
    name: options.name ?? 'jsonl',
    filePath,

    get buffered(): number {
      return buffer.length;
    },

    write(event: TelemetryEvent): Promise<void> {
      if (closed) {
        notify(
          new TelemetryWriteError(
            `telemetry sink for ${filePath} is closed; the "${event.name}" event was dropped — emit before close(), or open a new sink`,
            { filePath, lostEvents: 1 },
          ),
        );
        return Promise.resolve();
      }

      buffer.push(JSON.stringify(event));
      startTimer();

      if (buffer.length >= maxBufferedEvents) {
        return enqueueDrain();
      }
      return Promise.resolve();
    },

    flush(): Promise<void> {
      return enqueueDrain();
    },

    async close(): Promise<void> {
      closed = true;
      stopTimer();
      await enqueueDrain();
    },
  };
}
