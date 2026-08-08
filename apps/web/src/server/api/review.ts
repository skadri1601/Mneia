import 'server-only';

import type {
  ContextItemReview,
  PendingReviewItem,
  ReviewCapableStore,
  ReviewPendingItemsResult,
  TelemetryEmitter,
  TelemetryEvent,
  Uuid,
} from '@mneia/core';

export interface ReviewDependencies {
  readonly telemetry: TelemetryEmitter;
  readonly now: () => Date;
}

const emitQuietly = async (telemetry: TelemetryEmitter, event: TelemetryEvent): Promise<void> => {
  try {
    await telemetry.emit(event);
  } catch {
    return;
  }
};

export const listPendingReview = async (
  store: ReviewCapableStore,
  input: { readonly projectId: Uuid; readonly limit?: number | undefined },
): Promise<{ items: readonly PendingReviewItem[] }> => ({
  items: await store.listPendingReviewItems({
    projectId: input.projectId,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }),
});

export const reviewPendingItems = async (
  store: ReviewCapableStore,
  input: {
    readonly projectId: Uuid;
    readonly reviews: readonly ContextItemReview[];
    readonly summary?: string | null | undefined;
  },
  deps: ReviewDependencies,
): Promise<{ result: ReviewPendingItemsResult }> => {
  const result = await store.reviewPendingItems({
    projectId: input.projectId,
    reviews: input.reviews,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
  });

  const occurredAt = deps.now();
  const base = {
    workspaceId: store.scope.workspaceId,
    projectId: input.projectId,
    actorId: store.scope.actorId,
    sessionId: null,
    occurredAt,
    checkpointId: result.checkpoint.id,
  } as const;

  for (const outcome of result.outcomes) {
    if (outcome.outcome === 'confirmed') {
      await emitQuietly(deps.telemetry, {
        name: 'checkpoint.item_confirmed',
        ...base,
        itemId: outcome.itemId,
      });
      continue;
    }

    if (outcome.outcome === 'edited') {
      await emitQuietly(deps.telemetry, {
        name: 'checkpoint.item_edited',
        ...base,
        itemId: outcome.itemId,
        fieldsChanged: outcome.fieldsChanged,
      });
      continue;
    }

    await emitQuietly(deps.telemetry, {
      name: 'checkpoint.item_rejected',
      ...base,
      itemId: outcome.itemId,
    });
  }

  return { result };
};
