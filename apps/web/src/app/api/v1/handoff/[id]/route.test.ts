import type { ScopedStore } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../../../../server/api/handlers.js';

const calls: { handoffIds: string[] } = { handoffIds: [] };

vi.mock('../../../../../server/api/serve.js', () => ({
  serve: async (options: {
    input: string;
    run: (store: ScopedStore, input: string) => Promise<unknown>;
  }) => {
    await options.run({} as ScopedStore, options.input);
    return new Response(null);
  },
}));

vi.mock('../../../../../server/api/handoff.js', () => ({
  handleGetHandoff: async (_store: ScopedStore, handoffId: string) => {
    calls.handoffIds.push(handoffId);
    return { handoff: null };
  },
}));

import { GET } from './route.js';

const request = new Request('https://app.mneia.dev/api/v1/handoff/whatever');

const get = (id: string): Promise<Response> =>
  GET(request, { params: Promise.resolve({ id }) });

describe('the handoff GET route', () => {
  it('refuses a path segment that is not a UUID before it reaches the store', async () => {
    await expect(get('../../../etc/passwd')).rejects.toThrow(ApiRequestError);
    await expect(get('not-a-uuid')).rejects.toMatchObject({ code: 'invalid_request' });

    expect(calls.handoffIds).toEqual([]);
  });

  it('names what it expected, what it received, and what to do', async () => {
    await expect(get('42')).rejects.toThrow(
      /expected the handoff id in the path to be a UUID; received "42" — pass the id mneia pickup prints/,
    );
  });

  it('passes a well-formed id through untouched', async () => {
    const id = '66666666-1111-4111-8111-111111111111';

    await expect(get(id)).resolves.toBeInstanceOf(Response);
    expect(calls.handoffIds).toEqual([id]);
  });
});
