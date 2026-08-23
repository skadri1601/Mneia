import type { ReviewCapableStore } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const shared = vi.hoisted(() => ({
  seen: [] as string[],
  report: null as unknown,
}));

// serve is replaced so the route runs without auth, rate limiting or a database, but the
// error mapping stays real — an ApiRequestError thrown by run must still become an envelope.
vi.mock('../../../../server/api/serve.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../../server/api/serve.js')>();
  const { ApiRequestError } = await import('../../../../server/api/handlers.js');
  const { apiError, apiOk } = await import('../../../../server/api-auth.js');

  return {
    ...original,
    serve: async (options: {
      cost?: string;
      input: unknown;
      run: (store: ReviewCapableStore, input: unknown) => Promise<unknown>;
    }) => {
      shared.seen.push(String(options.cost));
      const store = { scope: { workspaceId: 'workspace-1', actorId: 'actor-1' } };
      try {
        return apiOk(await options.run(store as ReviewCapableStore, options.input));
      } catch (error) {
        if (error instanceof ApiRequestError) {
          return apiError(error.code, error.message);
        }
        throw error;
      }
    },
  };
});

vi.mock('../../../../server/billing/usage-store.js', () => ({
  loadUsageReport: async (workspaceId: string) => {
    shared.seen.push(workspaceId);
    return shared.report;
  },
}));

const { GET } = await import('./route.js');

const request = (): Request => new Request('https://app.mneia.dev/api/v1/usage');

const REPORT = {
  plan: 'pro',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-09-01T00:00:00.000Z',
  turns: { used: 1_000, allowance: 272_000, fraction: 1_000 / 272_000 },
  extractions: { used: 850, allowance: 1_700, fraction: 0.5 },
  embeddingTokens: { used: 90, allowance: 2_720_000, fraction: 0.0001 },
  checkpoints: 42,
  percentUsed: 50,
  warn: false,
};

describe('GET /api/v1/usage', () => {
  it('meters the workspace the token is scoped to, as a read', async () => {
    shared.seen.length = 0;
    shared.report = REPORT;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(shared.seen).toEqual(['read', 'workspace-1']);
  });

  // The embedding dial is recorded so cost is computable and is never rendered to a
  // customer, so it must not leave the hosted layer at all.
  it('does not put the embedding dial on the wire', async () => {
    shared.report = REPORT;

    const body = await (await GET(request())).json();

    expect(body).toEqual({
      plan: 'pro',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      turns: REPORT.turns,
      extractions: REPORT.extractions,
      checkpoints: 42,
      percentUsed: 50,
      warn: false,
    });
  });

  it('answers not_found rather than a zeroed report when there is no workspace row', async () => {
    shared.report = null;

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'not_found' } });
  });
});
