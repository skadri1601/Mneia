import type { PendingReviewFilterWire, ReviewCapableStore } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

const captured: { filter?: PendingReviewFilterWire; failure?: unknown } = {};

class TestApiRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

vi.mock('../../../../../server/api/handlers.js', () => ({
  ApiRequestError: TestApiRequestError,
}));

vi.mock('../../../../../server/api/serve.js', () => ({
  serve: async (options: {
    input: PendingReviewFilterWire;
    run: (store: ReviewCapableStore, input: PendingReviewFilterWire) => Promise<unknown>;
  }) => {
    captured.failure = undefined;
    try {
      await options.run({} as ReviewCapableStore, options.input);
    } catch (error) {
      captured.failure = error;
    }
    return new Response(null);
  },
}));

vi.mock('../../../../../server/api/review.js', () => ({
  handleListPendingReview: async (_store: ReviewCapableStore, filter: PendingReviewFilterWire) => {
    captured.filter = filter;
    return { items: [] };
  },
}));

const { GET } = await import('./route.js');

const PROJECT = '33333333-3333-4333-8333-333333333333';

describe('GET /api/v1/review/pending', () => {
  it('reads the project and the limit from the query string the CLI sends', async () => {
    await GET(
      new Request(`https://app.mneia.dev/api/v1/review/pending?projectId=${PROJECT}&limit=20`),
    );

    expect(captured.failure).toBeUndefined();
    expect(captured.filter).toEqual({ projectId: PROJECT, limit: 20 });
  });

  it('defaults the limit when the caller omits it', async () => {
    await GET(new Request(`https://app.mneia.dev/api/v1/review/pending?projectId=${PROJECT}`));

    expect(captured.filter).toEqual({ projectId: PROJECT });
  });

  it('names the missing project rather than reading a queue for nothing', async () => {
    await GET(new Request('https://app.mneia.dev/api/v1/review/pending'));

    expect(captured.failure).toBeInstanceOf(TestApiRequestError);
    expect((captured.failure as TestApiRequestError).code).toBe('invalid_request');
    expect((captured.failure as Error).message).toContain('projectId');
  });

  it('refuses a limit that is not a whole positive number', async () => {
    await GET(
      new Request(`https://app.mneia.dev/api/v1/review/pending?projectId=${PROJECT}&limit=zero`),
    );

    expect(captured.failure).toBeInstanceOf(TestApiRequestError);
  });
});
