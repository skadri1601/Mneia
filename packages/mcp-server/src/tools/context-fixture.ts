import type { ScopedStore, TelemetryEmitter, Uuid } from '@mneia/core';
import type { ReviewQueue } from '../review-queue.js';
import { createNoopReviewQueue } from '../review-queue.js';
import type { ResolvedWriteSession } from '../session-provenance.js';
import type { SliceLog } from '../slices.js';
import { createSliceLog } from '../slices.js';
import type { SourceSession } from '../source-session.js';
import type { ToolContext } from './types.js';

export interface ToolContextFixtureOptions {
  readonly now?: Date | undefined;
  readonly slices?: SliceLog | undefined;
  readonly reviewQueue?: ReviewQueue | undefined;
  readonly sessionIdFor?: ((projectId: Uuid) => Uuid | null) | undefined;
  readonly resolveWriteSession?:
    | ((
        projectId: Uuid,
        sourceSession: SourceSession | undefined,
        legacySessionId: Uuid | null,
      ) => Promise<ResolvedWriteSession>)
    | undefined;
  readonly defaultProject?: string | null | undefined;
}

export function createToolContextFixture(
  store: ScopedStore,
  telemetry: TelemetryEmitter,
  options: ToolContextFixtureOptions = {},
): ToolContext {
  const at = options.now ?? new Date('2026-01-01T00:00:00.000Z');
  const sessionIdFor = options.sessionIdFor ?? (() => null);
  return {
    store,
    telemetry,
    now: () => at,
    slices: options.slices ?? createSliceLog(),
    reviewQueue: options.reviewQueue ?? createNoopReviewQueue(),
    sessionIdFor,
    resolveWriteSession:
      options.resolveWriteSession ??
      ((projectId, sourceSession, legacySessionId) =>
        Promise.resolve({
          sessionId: legacySessionId ?? sessionIdFor(projectId),
          checkpointSource: null,
          sourceSessionRef: sourceSession?.ref ?? null,
        })),
    defaultProject: options.defaultProject ?? null,
  };
}
