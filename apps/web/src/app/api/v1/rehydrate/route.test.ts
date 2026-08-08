import type { EmbeddingProvider, ScopedStore } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';

const provider = { model: 'text-embedding-3-small', embed: async () => [] } as EmbeddingProvider;

const captured: { deps?: Record<string, unknown> } = {};

vi.mock('../../../../server/api/serve.js', () => ({
  serve: async (options: { run: (store: ScopedStore, input: unknown) => Promise<unknown> }) => {
    await options.run({} as ScopedStore, { project: 'mneia', task: 'ship the API' });
    return new Response(null);
  },
}));

vi.mock('../../../../server/api/handlers.js', () => ({
  handleRehydrate: async (_store: ScopedStore, _input: unknown, deps: Record<string, unknown>) => {
    captured.deps = deps;
    return {};
  },
}));

vi.mock('../../../../server/embedding-runtime.js', () => ({
  embeddingProvider: () => provider,
}));

vi.mock('../../../../server/telemetry-runtime.js', () => ({
  telemetry: () => ({ emit: async () => {} }),
}));

import { POST } from './route.js';

describe('the rehydrate route', () => {
  it('passes the embedding provider through, or the semantic weight ranks nothing', async () => {
    await POST(new Request('https://app.mneia.dev/api/v1/rehydrate', { method: 'POST' }));

    expect(captured.deps?.embeddings).toBe(provider);
  });
});
