import 'server-only';

import type {
  ContextItemReview,
  PendingReviewItem,
  ReviewPendingItemsResult,
  Uuid,
} from '@mneia/core';
import { listPendingReview, reviewPendingItems } from './api/review.js';
import { withWorkspaceScope } from './store-runtime.js';
import { telemetry } from './telemetry-runtime.js';

export interface ReviewScope {
  readonly workspaceId: Uuid;
  readonly actorId: Uuid;
}

export const pendingReviewItems = (
  scope: ReviewScope,
  projectId: Uuid,
): Promise<readonly PendingReviewItem[]> =>
  withWorkspaceScope(scope, async (store) => {
    const { items } = await listPendingReview(store, { projectId });
    return items;
  });

export const submitReview = (
  scope: ReviewScope,
  input: {
    readonly projectId: Uuid;
    readonly reviews: readonly ContextItemReview[];
    readonly summary?: string | null | undefined;
  },
): Promise<ReviewPendingItemsResult> =>
  withWorkspaceScope(scope, async (store) => {
    const { result } = await reviewPendingItems(store, input, {
      telemetry: telemetry(),
      now: () => new Date(),
    });
    return result;
  });
