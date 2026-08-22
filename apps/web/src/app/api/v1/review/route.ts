import { ReviewPendingItemsWireSchema } from '@mneia/core';
import { handleReviewPendingItems } from '../../../../server/api/review.js';
import { serve } from '../../../../server/api/serve.js';
import { telemetry } from '../../../../server/telemetry-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ReviewPendingItemsWireSchema,
    run: (store, input) =>
      handleReviewPendingItems(store, input, {
        telemetry: telemetry(),
        now: () => new Date(),
      }),
  });
