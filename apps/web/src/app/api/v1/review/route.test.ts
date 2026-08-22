import type { ReviewCapableStore, ReviewPendingItemsWire } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

const captured: {
  input?: ReviewPendingItemsWire;
  deps?: Record<string, unknown>;
  schemaAccepted?: boolean;
} = {};

vi.mock('../../../../server/api/serve.js', () => ({
  serve: async (options: {
    schema: { safeParse: (value: unknown) => { success: boolean; data?: unknown } };
    run: (store: ReviewCapableStore, input: ReviewPendingItemsWire) => Promise<unknown>;
  }) => {
    const parsed = options.schema.safeParse({
      projectId: '33333333-3333-4333-8333-333333333333',
      reviews: [
        {
          itemId: '11111111-1111-4111-8111-111111111111',
          decision: 'accept',
          humanConfirmed: true,
          assertedBy: '99999999-9999-4999-8999-999999999999',
        },
      ],
      summary: '1 confirmed',
    });
    captured.schemaAccepted = parsed.success;
    await options.run({} as ReviewCapableStore, parsed.data as ReviewPendingItemsWire);
    return new Response(null);
  },
}));

vi.mock('../../../../server/api/review.js', () => ({
  handleReviewPendingItems: async (
    _store: ReviewCapableStore,
    input: ReviewPendingItemsWire,
    deps: Record<string, unknown>,
  ) => {
    captured.input = input;
    captured.deps = deps;
    return { result: {} };
  },
}));

const emitter = { emit: async () => {} };

vi.mock('../../../../server/telemetry-runtime.js', () => ({ telemetry: () => emitter }));

const { POST } = await import('./route.js');

describe('POST /api/v1/review', () => {
  it('passes the telemetry emitter through, so the §17 events come from the server not the client', async () => {
    await POST(new Request('https://app.mneia.dev/api/v1/review', { method: 'POST' }));

    expect(captured.deps?.telemetry).toBe(emitter);
    expect(typeof captured.deps?.now).toBe('function');
  });

  it('strips human_confirmed and asserted_by at the boundary, so a caller cannot confirm on a human behalf', async () => {
    await POST(new Request('https://app.mneia.dev/api/v1/review', { method: 'POST' }));

    expect(captured.schemaAccepted).toBe(true);
    expect(captured.input?.reviews).toEqual([
      { itemId: '11111111-1111-4111-8111-111111111111', decision: 'accept' },
    ]);
    expect(JSON.stringify(captured.input)).not.toMatch(/human_?[Cc]onfirmed|asserted_?[Bb]y/);
  });
});
