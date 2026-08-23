import type { ScopedStore } from '@mneia/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RateLimitBucket, RateLimitConfig } from '../rate-limit.js';
import type { BearerIdentity } from '../store/device-store.js';
import type { RateLimitStore } from '../store/rate-limit-store.js';

const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const TOKEN = 'mneia_dogfood_token';

const captured: { error: unknown; hint: unknown }[] = [];

vi.mock('server-only', () => ({}));

vi.mock('@sentry/nextjs', () => ({
  captureException: (error: unknown, hint: unknown) => {
    captured.push({ error, hint });
    return 'event-id';
  },
  init: () => undefined,
  captureRequestError: () => undefined,
}));

vi.mock('../device-runtime.js', () => ({
  deviceStore: {
    identify: async (): Promise<BearerIdentity> => ({
      tokenId: '55555555-5555-4555-8555-555555555555',
      workspaceId: WORKSPACE,
      actorId: ACTOR,
      workspaceName: 'Mneia',
      workspaceSlug: 'mneia',
      actorName: 'claude-code',
      actorKind: 'agent',
      teamId: '66666666-6666-4666-8666-666666666666',
      teamName: 'Core',
    }),
  },
}));

vi.mock('../store-runtime.js', () => ({
  withWorkspaceScope: async <T>(_scope: unknown, run: (store: ScopedStore) => Promise<T>) =>
    run({} as unknown as ScopedStore),
}));

vi.mock('../rate-limit-runtime.js', () => ({
  rateLimitStore: () => {
    throw new Error('the test must inject its own rate-limit store');
  },
  rateLimitConfig: () => {
    throw new Error('the test must inject its own rate-limit config');
  },
}));

const { serve } = await import('./serve.js');

const config: RateLimitConfig = {
  requestsPerMinute: 120,
  maxRequestBytes: 1_048_576,
};

const released: number[] = [];

const limits = {
  store: {
    bump: async (): Promise<ReadonlyMap<RateLimitBucket, number>> => new Map(),
    release: async (): Promise<void> => {
      released.push(1);
    },
  } satisfies RateLimitStore,
  config,
  now: () => new Date('2026-08-16T12:00:00.000Z'),
};

const request = (body: unknown): Request =>
  new Request('https://app.mneia.dev/api/v1/rehydrate?task=redact+me', {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('serve', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  it('reports an unhandled route error to Sentry with the route, class, method and stack', async () => {
    const boom = new TypeError('embeddings.rank is not a function');

    await expect(
      serve({
        request: request({ task: 'a private task string' }),
        input: {},
        limits,
        run: async () => {
          throw boom;
        },
      }),
    ).rejects.toBe(boom);

    expect(captured).toHaveLength(1);
    const event = captured[0];
    expect(event).toBeDefined();
    expect(event?.error).toBe(boom);
    expect(event?.hint).toEqual({
      tags: {
        mneia_route: '/api/v1/rehydrate',
        mneia_method: 'POST',
        mneia_error_class: 'TypeError',
      },
    });
    const reported = event?.error;
    expect(reported).toBeInstanceOf(Error);
    expect(reported instanceof Error ? reported.stack : null).toContain('serve.test.ts');
  });

  it('carries no request body, no query string and no token into the reported payload', async () => {
    const secretBearing = new Error('failed while ranking');

    await expect(
      serve({
        request: request({ task: 'a private task string', body: 'a load-bearing constraint' }),
        input: {},
        limits,
        run: async () => {
          throw secretBearing;
        },
      }),
    ).rejects.toBe(secretBearing);

    const serialised = JSON.stringify(captured);
    expect(serialised).not.toContain('a private task string');
    expect(serialised).not.toContain('a load-bearing constraint');
    expect(serialised).not.toContain('redact+me');
    expect(serialised).not.toContain(TOKEN);
  });

  it('does not report an error it already turned into a structured response', async () => {
    const { ApiRequestError } = await import('./handlers.js');

    const response = await serve({
      request: request({}),
      input: {},
      limits,
      run: async () => {
        throw new ApiRequestError('invalid_request', 'the project slug is unknown');
      },
    });

    expect(response.status).toBe(400);
    expect(captured).toHaveLength(0);
  });
});
