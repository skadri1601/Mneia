export type {
  EnvLike,
  TelemetryEmitterOptions,
  TelemetrySinkOperation,
} from './emitter.js';
export {
  createNoopEmitter,
  createTelemetryEmitter,
  DEFAULT_SINK_CONCURRENCY,
  TELEMETRY_ENV_VAR,
  TELEMETRY_OFF_VALUES,
  TelemetrySinkError,
  TelemetryValidationError,
  telemetryEnabledIn,
} from './emitter.js';
export type { Redaction } from './redact.js';
export { isRedactedKey, REDACTED_KEYS, redactEvent } from './redact.js';
export type { JsonlSinkOptions, JsonlTelemetrySink } from './sinks/jsonl.js';
export {
  createJsonlSink,
  DEFAULT_FLUSH_INTERVAL_MS,
  DEFAULT_MAX_BUFFERED_EVENTS,
  TelemetryWriteError,
} from './sinks/jsonl.js';
export type { MemorySinkOptions, MemoryTelemetrySink, TelemetryEventOf } from './sinks/memory.js';
export { createMemorySink } from './sinks/memory.js';
export * from './sinks/remote.js';
export type {
  ConflictDetectedEvent,
  ConflictResolvedEvent,
  HandoffCreatedEvent,
  HandoffReceivedEvent,
  HandoffTimeToFirstActionEvent,
  ItemConfirmedEvent,
  ItemEditedEvent,
  ItemExtractedEvent,
  ItemIgnoredEvent,
  ItemReferencedEvent,
  ItemRejectedEvent,
  ItemSupersededEvent,
  SliceShownEvent,
  TelemetryContext,
  TelemetryEmitter,
  TelemetryEvent,
  TelemetryEventName,
  TelemetrySink,
} from './types.js';
export { TELEMETRY_EVENT_NAMES } from './types.js';
