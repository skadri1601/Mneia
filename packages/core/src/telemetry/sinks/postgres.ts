import { randomUUID } from 'node:crypto';
import type { PostgresConnectionSource, PostgresSession } from '../../store/adapter/postgres.js';
import type { SqlValue } from '../../store/driver.js';
import { assertConnectionEnforcesRls } from '../../store/rls-guard.js';
import { WORKSPACE_SETTING } from '../../store/schema.js';
import type { TelemetryEvent, TelemetrySink } from '../types.js';

export const TELEMETRY_EVENT_TABLE = 'telemetry_event';

export const DEFAULT_STORE_FLUSH_INTERVAL_MS = 1_000;

export const DEFAULT_STORE_MAX_BUFFERED_EVENTS = 200;

const COLUMN_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'workspaceId',
  'projectId',
  'actorId',
  'sessionId',
  'occurredAt',
]);

export class TelemetryPersistError extends Error {
  readonly lostEvents: number;
  readonly workspaceId: string | null;

  constructor(
    message: string,
    details: {
      readonly lostEvents: number;
      readonly workspaceId: string | null;
      readonly cause?: unknown;
    },
  ) {
    super(message, { cause: details.cause });
    this.name = 'TelemetryPersistError';
    this.lostEvents = details.lostEvents;
    this.workspaceId = details.workspaceId;
  }
}

export interface PostgresSinkOptions {
  readonly source: PostgresConnectionSource;
  readonly name?: string | undefined;
  readonly flushIntervalMs?: number | undefined;
  readonly maxBufferedEvents?: number | undefined;
  readonly onError?: ((error: TelemetryPersistError) => void) | undefined;
}

export interface PostgresTelemetrySink extends TelemetrySink {
  readonly buffered: number;
}

const payloadOf = (event: TelemetryEvent): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!COLUMN_FIELDS.has(key)) {
      payload[key] = value;
    }
  }
  return payload;
};

const optionalId = (value: string | null | undefined): SqlValue => value ?? null;

const statementFor = (events: readonly TelemetryEvent[]): { sql: string; params: SqlValue[] } => {
  const params: SqlValue[] = [];
  const tuples = events.map((event) => {
    const base = params.length;
    params.push(
      randomUUID(),
      event.workspaceId,
      optionalId(event.projectId),
      optionalId(event.actorId),
      optionalId(event.sessionId),
      event.name,
      event.occurredAt,
      JSON.stringify(payloadOf(event)),
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb)`;
  });

  return {
    sql: `INSERT INTO ${TELEMETRY_EVENT_TABLE} (id, workspace_id, project_id, actor_id, session_id, name, occurred_at, payload) VALUES ${tuples.join(', ')}`,
    params,
  };
};

const groupByWorkspace = (
  events: readonly TelemetryEvent[],
): ReadonlyMap<string, TelemetryEvent[]> => {
  const groups = new Map<string, TelemetryEvent[]>();
  for (const event of events) {
    const existing = groups.get(event.workspaceId);
    if (existing === undefined) {
      groups.set(event.workspaceId, [event]);
    } else {
      existing.push(event);
    }
  }
  return groups;
};

export function createPostgresSink(options: PostgresSinkOptions): PostgresTelemetrySink {
  const source = options.source;
  const flushIntervalMs = options.flushIntervalMs ?? DEFAULT_STORE_FLUSH_INTERVAL_MS;
  const maxBufferedEvents = Math.max(
    1,
    options.maxBufferedEvents ?? DEFAULT_STORE_MAX_BUFFERED_EVENTS,
  );
  const report = options.onError;

  let buffer: TelemetryEvent[] = [];
  let pending: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const notify = (error: TelemetryPersistError): void => {
    if (report === undefined) {
      return;
    }
    queueMicrotask(() => {
      report(error);
    });
  };

  const write = async (workspaceId: string, events: readonly TelemetryEvent[]): Promise<void> => {
    const session: PostgresSession = await source.acquire();
    let discardSession = false;

    try {
      await assertConnectionEnforcesRls(session);
      await session.execute('BEGIN');
      try {
        await session.execute('SELECT set_config($1, $2, true)', [WORKSPACE_SETTING, workspaceId]);
        const { sql, params } = statementFor(events);
        await session.execute(sql, params);
        await session.execute('COMMIT');
      } catch (error) {
        try {
          await session.execute('ROLLBACK');
        } catch {
          discardSession = true;
        }
        throw error;
      }
    } finally {
      if (discardSession) {
        await session.discard();
      } else {
        await session.release();
      }
    }
  };

  const drain = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }

    const batch = buffer;
    buffer = [];

    for (const [workspaceId, events] of groupByWorkspace(batch)) {
      try {
        await write(workspaceId, events);
      } catch (cause) {
        notify(
          new TelemetryPersistError(
            `telemetry sink could not persist ${events.length} §17 event(s) for workspace ${workspaceId} to ${TELEMETRY_EVENT_TABLE}; those events are lost — check the store is reachable and that the application role does not bypass row-level security`,
            { lostEvents: events.length, workspaceId, cause },
          ),
        );
      }
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
    timer.unref?.();
  };

  return {
    name: options.name ?? 'postgres',

    get buffered(): number {
      return buffer.length;
    },

    write(event: TelemetryEvent): Promise<void> {
      if (closed) {
        notify(
          new TelemetryPersistError(
            `the postgres telemetry sink is closed; the "${event.name}" event was dropped — emit before close(), or open a new sink`,
            { lostEvents: 1, workspaceId: event.workspaceId },
          ),
        );
        return Promise.resolve();
      }

      buffer.push(event);
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
