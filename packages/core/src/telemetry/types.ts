import type { Uuid } from '../domain/types.js';
import type { CheckpointTrigger, ConflictResolution, ItemKind } from '../store/schema.js';

export const TELEMETRY_EVENT_NAMES = [
  'rehydration.slice_shown',
  'rehydration.item_referenced',
  'rehydration.item_ignored',
  'checkpoint.item_extracted',
  'checkpoint.item_confirmed',
  'checkpoint.item_edited',
  'checkpoint.item_rejected',
  'conflict.detected',
  'conflict.resolved',
  'item.superseded',
  'handoff.created',
  'handoff.received',
  'handoff.time_to_first_action',
] as const;

export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

export interface TelemetryContext {
  readonly workspaceId: Uuid;
  readonly projectId: Uuid;
  readonly actorId: Uuid;
  readonly sessionId?: Uuid | null;
  readonly occurredAt: Date;
}

interface EventBase<TName extends TelemetryEventName> extends TelemetryContext {
  readonly name: TName;
}

export interface SliceShownEvent extends EventBase<'rehydration.slice_shown'> {
  readonly sliceId: Uuid;
  readonly itemIds: readonly Uuid[];
  readonly tokenBudget: number;
  readonly tokensUsed: number;
  readonly durationMs: number;
}

export interface ItemReferencedEvent extends EventBase<'rehydration.item_referenced'> {
  readonly sliceId: Uuid;
  readonly itemId: Uuid;
}

export interface ItemIgnoredEvent extends EventBase<'rehydration.item_ignored'> {
  readonly sliceId: Uuid;
  readonly itemId: Uuid;
}

export interface ExtractionCoverage {
  readonly droppedTurns: number;
  readonly splitTurns: number;
  readonly pendingTurns: number;
  readonly consumedTurns: number;
  readonly incompleteCode: 'provider_failed' | 'invalid_output' | null;
}

export interface ItemExtractedEvent extends EventBase<'checkpoint.item_extracted'> {
  readonly checkpointId: Uuid;
  readonly itemId: Uuid;
  readonly kind: ItemKind;
  readonly confidence: number;
  readonly loadBearing: boolean;
  readonly trigger: CheckpointTrigger;
  readonly coverage?: ExtractionCoverage | undefined;
}

export interface ItemConfirmedEvent extends EventBase<'checkpoint.item_confirmed'> {
  readonly checkpointId: Uuid;
  readonly itemId: Uuid;
}

export interface ItemEditedEvent extends EventBase<'checkpoint.item_edited'> {
  readonly checkpointId: Uuid;
  readonly itemId: Uuid;
  readonly fieldsChanged: readonly string[];
}

export interface ItemRejectedEvent extends EventBase<'checkpoint.item_rejected'> {
  readonly checkpointId: Uuid;
  readonly itemId: Uuid;
}

export interface ConflictDetectedEvent extends EventBase<'conflict.detected'> {
  readonly conflictId: Uuid;
  readonly itemA: Uuid;
  readonly itemB: Uuid;
  readonly loadBearing: boolean;
}

export interface ConflictResolvedEvent extends EventBase<'conflict.resolved'> {
  readonly conflictId: Uuid;
  readonly itemA: Uuid;
  readonly itemB: Uuid;
  readonly resolution: ConflictResolution;
  readonly resolvedBy: Uuid;
}

export interface ItemSupersededEvent extends EventBase<'item.superseded'> {
  readonly previousItemId: Uuid;
  readonly nextItemId: Uuid;
}

export interface HandoffCreatedEvent extends EventBase<'handoff.created'> {
  readonly handoffId: Uuid;
  readonly itemIds: readonly Uuid[];
  readonly toActor: Uuid | null;
}

export interface HandoffReceivedEvent extends EventBase<'handoff.received'> {
  readonly handoffId: Uuid;
  readonly receivedBy: Uuid;
}

export interface HandoffTimeToFirstActionEvent extends EventBase<'handoff.time_to_first_action'> {
  readonly handoffId: Uuid;
  readonly elapsedMs: number;
}

export type TelemetryEvent =
  | SliceShownEvent
  | ItemReferencedEvent
  | ItemIgnoredEvent
  | ItemExtractedEvent
  | ItemConfirmedEvent
  | ItemEditedEvent
  | ItemRejectedEvent
  | ConflictDetectedEvent
  | ConflictResolvedEvent
  | ItemSupersededEvent
  | HandoffCreatedEvent
  | HandoffReceivedEvent
  | HandoffTimeToFirstActionEvent;

export interface TelemetrySink {
  readonly name: string;
  write(event: TelemetryEvent): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface TelemetryEmitter {
  emit(event: TelemetryEvent): Promise<void>;
  flush(): Promise<void>;
  close(): Promise<void>;
}
