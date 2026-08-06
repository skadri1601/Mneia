import type { ScopedStore, TelemetryEmitter, Uuid } from '@mneia/core';
import type { ReviewQueue } from '../review-queue.js';
import { createNoopReviewQueue } from '../review-queue.js';
import type { SliceLog } from '../slices.js';
import { createSliceLog } from '../slices.js';
import type { ToolContext } from './types.js';

export interface ToolContextFixtureOptions {
  readonly now?: Date | undefined;
  readonly slices?: SliceLog | undefined;
  readonly reviewQueue?: ReviewQueue | undefined;
  readonly sessionIdFor?: ((projectId: Uuid) => Uuid | null) | undefined;
}

export function createToolContextFixture(
  store: ScopedStore,
  telemetry: TelemetryEmitter,
  options: ToolContextFixtureOptions = {},
): ToolContext {
  const at = options.now ?? new Date('2026-01-01T00:00:00.000Z');
  return {
    store,
    telemetry,
    now: () => at,
    slices: options.slices ?? createSliceLog(),
    reviewQueue: options.reviewQueue ?? createNoopReviewQueue(),
    sessionIdFor: options.sessionIdFor ?? (() => null),
  };
}
