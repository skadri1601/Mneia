import { PendingReviewFilterWireSchema } from '@mneia/core';
import { ApiRequestError } from '../../../../../server/api/handlers.js';
import { handleListPendingReview } from '../../../../../server/api/review.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const describeIssues = (issues: readonly { path: readonly PropertyKey[]; message: string }[]) =>
  issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

export const GET = (request: Request): Promise<Response> => {
  const params = new URL(request.url).searchParams;
  const limit = params.get('limit');

  return serve({
    request,
    input: {
      projectId: params.get('projectId') ?? '',
      ...(limit === null ? {} : { limit: Number(limit) }),
    },
    run: (store, query) => {
      const parsed = PendingReviewFilterWireSchema.safeParse(query);
      if (!parsed.success) {
        throw new ApiRequestError(
          'invalid_request',
          `expected ?projectId= naming the project whose review queue to read, and an optional ?limit=; received ${describeIssues(parsed.error.issues)} — send the project id the queue belongs to`,
        );
      }
      return handleListPendingReview(store, parsed.data);
    },
  });
};
