import { z } from 'zod';
import { LOAD_BEARING_SIGNALS } from '../extract/load-bearing.js';
import { CHECKPOINT_TRIGGERS, CONFLICT_RESOLUTIONS, ITEM_KINDS } from '../store/schema.js';
import { redactEvent } from './redact.js';
import type {
  TelemetryEmitter,
  TelemetryEvent,
  TelemetryEventName,
  TelemetrySink,
} from './types.js';
import { TELEMETRY_EVENT_NAMES } from './types.js';

const id = z.string().min(1);
const idList = z.array(id);
const nullableId = z.union([id, z.null()]);
const duration = z.number().nonnegative();
const count = z.int().nonnegative();

const context = {
  workspaceId: id,
  projectId: id,
  actorId: id,
  sessionId: nullableId.optional(),
  occurredAt: z.date(),
};

const EVENT_SCHEMAS: Record<TelemetryEventName, z.ZodType> = {
  'rehydration.slice_shown': z.strictObject({
    name: z.literal('rehydration.slice_shown'),
    ...context,
    sliceId: id,
    itemIds: idList,
    tokenBudget: count,
    tokensUsed: count,
    durationMs: duration,
  }),
  'rehydration.item_referenced': z.strictObject({
    name: z.literal('rehydration.item_referenced'),
    ...context,
    sliceId: id,
    itemId: id,
  }),
  'rehydration.item_ignored': z.strictObject({
    name: z.literal('rehydration.item_ignored'),
    ...context,
    sliceId: id,
    itemId: id,
  }),
  'checkpoint.item_extracted': z.strictObject({
    name: z.literal('checkpoint.item_extracted'),
    ...context,
    checkpointId: id,
    itemId: id,
    kind: z.enum(ITEM_KINDS),
    confidence: z.number().min(0).max(1),
    loadBearing: z.boolean(),
    trigger: z.enum(CHECKPOINT_TRIGGERS),
    coverage: z
      .strictObject({
        droppedTurns: z.number().int().min(0),
        splitTurns: z.number().int().min(0),
        pendingTurns: z.number().int().min(0),
        consumedTurns: z.number().int().min(0),
        incompleteCode: z.enum(['provider_failed', 'invalid_output']).nullable(),
      })
      .optional(),
  }),
  'checkpoint.item_confirmed': z.strictObject({
    name: z.literal('checkpoint.item_confirmed'),
    ...context,
    checkpointId: id,
    itemId: id,
  }),
  'checkpoint.item_edited': z.strictObject({
    name: z.literal('checkpoint.item_edited'),
    ...context,
    checkpointId: id,
    itemId: id,
    fieldsChanged: z.array(z.string().min(1)),
  }),
  'checkpoint.item_rejected': z.strictObject({
    name: z.literal('checkpoint.item_rejected'),
    ...context,
    checkpointId: id,
    itemId: id,
  }),
  'checkpoint.load_bearing_overridden': z.strictObject({
    name: z.literal('checkpoint.load_bearing_overridden'),
    ...context,
    checkpointId: id,
    itemId: id,
    kind: z.enum(ITEM_KINDS),
    suggested: z.boolean(),
    chosen: z.boolean(),
    signal: z.enum(LOAD_BEARING_SIGNALS),
    confidence: z.number().min(0).max(1),
  }),
  'conflict.detected': z.strictObject({
    name: z.literal('conflict.detected'),
    ...context,
    conflictId: id,
    itemA: id,
    itemB: id,
    loadBearing: z.boolean(),
  }),
  'conflict.resolved': z.strictObject({
    name: z.literal('conflict.resolved'),
    ...context,
    conflictId: id,
    itemA: id,
    itemB: id,
    resolution: z.enum(CONFLICT_RESOLUTIONS),
    resolvedBy: id,
  }),
  'item.superseded': z.strictObject({
    name: z.literal('item.superseded'),
    ...context,
    previousItemId: id,
    nextItemId: id,
  }),
  'handoff.created': z.strictObject({
    name: z.literal('handoff.created'),
    ...context,
    handoffId: id,
    itemIds: idList,
    toActor: nullableId,
  }),
  'handoff.received': z.strictObject({
    name: z.literal('handoff.received'),
    ...context,
    handoffId: id,
    receivedBy: id,
  }),
  'handoff.time_to_first_action': z.strictObject({
    name: z.literal('handoff.time_to_first_action'),
    ...context,
    handoffId: id,
    elapsedMs: duration,
  }),
};

const SCHEMA_BY_NAME: ReadonlyMap<string, z.ZodType> = new Map(Object.entries(EVENT_SCHEMAS));

export class TelemetryValidationError extends Error {
  readonly eventName: string;
  readonly issues: readonly string[];

  constructor(eventName: string, issues: readonly string[]) {
    super(
      `telemetry event "${eventName}" does not match its §17 schema: ${issues.join('; ')} — a malformed event is a programming error, not a runtime condition; fix the call site rather than the schema`,
    );
    this.name = 'TelemetryValidationError';
    this.eventName = eventName;
    this.issues = issues;
  }
}

export type TelemetrySinkOperation = 'write' | 'flush' | 'close';

export class TelemetrySinkError extends Error {
  readonly sinkName: string;
  readonly operation: TelemetrySinkOperation;
  readonly eventName: TelemetryEventName | null;

  constructor(
    sinkName: string,
    operation: TelemetrySinkOperation,
    eventName: TelemetryEventName | null,
    cause: unknown,
  ) {
    const subject = eventName === null ? 'no event' : `event "${eventName}"`;
    super(
      `telemetry sink "${sinkName}" failed to ${operation} (${subject}); the write path continued and the event was dropped for this sink only`,
      { cause },
    );
    this.name = 'TelemetrySinkError';
    this.sinkName = sinkName;
    this.operation = operation;
    this.eventName = eventName;
  }
}

export const TELEMETRY_ENV_VAR = 'MNEIA_TELEMETRY';

export const TELEMETRY_OFF_VALUES = ['off', 'false', 'no', 'none', '0'] as const;

const OFF = new Set<string>(TELEMETRY_OFF_VALUES);

export type EnvLike = Readonly<Record<string, string | undefined>>;

export function telemetryEnabledIn(env: EnvLike): boolean {
  const configured = env[TELEMETRY_ENV_VAR];
  if (configured === undefined) {
    return true;
  }
  return !OFF.has(configured.trim().toLowerCase());
}

export const DEFAULT_SINK_CONCURRENCY = 4;

export interface TelemetryEmitterOptions {
  readonly sinks: readonly TelemetrySink[];
  readonly onError?: ((error: TelemetrySinkError) => void) | undefined;
  readonly enabled?: boolean | undefined;
  readonly concurrency?: number | undefined;
  readonly env?: EnvLike | undefined;
}

async function forEachBounded<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) {
        await run(item);
      }
    }
  };

  const width = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: width }, worker));
}

function describeIssues(error: z.ZodError, redacted: readonly string[]): readonly string[] {
  const issues = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    const keys = issue.code === 'unrecognized_keys' ? ` [${issue.keys.join(', ')}]` : '';
    return `${path}: ${issue.message}${keys}`;
  });

  if (redacted.length === 0) {
    return issues;
  }

  return [
    ...issues,
    `redaction removed ${redacted.join(', ')} before validation — §17 events carry ids, types, and outcomes, never bodies`,
  ];
}

function assertValidEvent(event: TelemetryEvent, redacted: readonly string[]): void {
  const schema = SCHEMA_BY_NAME.get(event.name);

  if (schema === undefined) {
    throw new TelemetryValidationError(String(event.name), [
      `(root): unknown event name; expected one of ${TELEMETRY_EVENT_NAMES.join(', ')}`,
    ]);
  }

  const result = schema.safeParse(event);
  if (!result.success) {
    throw new TelemetryValidationError(event.name, describeIssues(result.error, redacted));
  }
}

export function createTelemetryEmitter(options: TelemetryEmitterOptions): TelemetryEmitter {
  const sinks = [...options.sinks];
  const report = options.onError;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_SINK_CONCURRENCY);
  const enabled = options.enabled ?? telemetryEnabledIn(options.env ?? process.env);

  const fanOut = async (
    operation: TelemetrySinkOperation,
    eventName: TelemetryEventName | null,
    run: (sink: TelemetrySink) => Promise<void>,
  ): Promise<void> => {
    const failures: TelemetrySinkError[] = [];

    await forEachBounded(sinks, concurrency, async (sink) => {
      try {
        await run(sink);
      } catch (cause) {
        failures.push(new TelemetrySinkError(sink.name, operation, eventName, cause));
      }
    });

    for (const failure of failures) {
      report?.(failure);
    }
  };

  return {
    emit(event: TelemetryEvent): Promise<void> {
      if (!enabled) {
        return Promise.resolve();
      }

      const { event: safe, redacted } = redactEvent(event);
      assertValidEvent(safe, redacted);

      return fanOut('write', safe.name, (sink) => sink.write(safe));
    },

    flush(): Promise<void> {
      return fanOut('flush', null, (sink) => sink.flush());
    },

    close(): Promise<void> {
      return fanOut('close', null, (sink) => sink.close());
    },
  };
}

export function createNoopEmitter(): TelemetryEmitter {
  return createTelemetryEmitter({ sinks: [], enabled: false });
}
