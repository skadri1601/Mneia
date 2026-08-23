import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createExtractionRunner, ExtractionRunError } = await import('./select.js');
const { ExtractionProviderError, resolveExtractionModel } = await import('./providers.js');

const OPENAI_BODY = {
  output_text: '{"candidates":[]}',
  usage: { input_tokens: 1200, output_tokens: 80 },
};

const ANTHROPIC_BODY = {
  content: [{ type: 'text', text: '{"candidates":[{"title":"from the fallback"}]}' }],
  usage: { input_tokens: 900, output_tokens: 60 },
};

const ok = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const failure = (status: number): Response => new Response('upstream is unhappy', { status });

const request = { system: 'system', user: 'user', maxOutputTokens: 4096 };

const runnerWith = (fetchImpl: typeof globalThis.fetch, overrides = {}) =>
  createExtractionRunner({
    openaiApiKey: 'openai-key',
    anthropicApiKey: 'anthropic-key',
    fetch: fetchImpl,
    now: (() => {
      let tick = 0;
      return () => {
        tick += 10;
        return tick;
      };
    })(),
    ...overrides,
  });

describe('resolveExtractionModel', () => {
  it('refuses a model that is not on the allowlist', () => {
    expect(() => resolveExtractionModel('gpt-9-imaginary', 'MNEIA_EXTRACTION_MODEL')).toThrow(
      /MNEIA_EXTRACTION_MODEL/,
    );
  });

  it('accepts the shipped defaults', () => {
    expect(resolveExtractionModel('gpt-5.6-luna', 'x').vendor).toBe('openai');
    expect(resolveExtractionModel('claude-haiku-4-5', 'x').vendor).toBe('anthropic');
  });

  it('allows exactly the two ruled models and nothing else', async () => {
    const { EXTRACTION_MODELS } = await import('./providers.js');

    expect(EXTRACTION_MODELS.map((model) => model.id)).toEqual([
      'gpt-5.6-luna',
      'claude-haiku-4-5',
    ]);
  });

  it('refuses every other model, including more capable ones from the same vendors', () => {
    for (const model of [
      'gpt-5.6-terra',
      'gpt-5.6-sol',
      'gpt-5.1',
      'claude-sonnet-5',
      'claude-opus-5',
      '',
    ]) {
      expect(() => resolveExtractionModel(model, 'MNEIA_EXTRACTION_MODEL')).toThrow(
        /MNEIA_EXTRACTION_MODEL/,
      );
    }
  });
});

describe('createExtractionRunner', () => {
  it('uses Luna as primary and Haiku as fallback by default', () => {
    const runner = runnerWith(vi.fn());
    expect(runner.primary).toBe('gpt-5.6-luna');
    expect(runner.fallback).toBe('claude-haiku-4-5');
  });

  it('returns the primary result and never calls the fallback when the primary succeeds', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return ok(OPENAI_BODY);
    }) as unknown as typeof globalThis.fetch;

    const result = await runnerWith(fetchImpl).run(request);

    expect(result.model).toBe('gpt-5.6-luna');
    expect(result.text).toBe('{"candidates":[]}');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('api.openai.com');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({ outcome: 'succeeded', inputTokens: 1200 });
  });

  it('falls back to the other vendor when the primary is rate limited', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return String(url).includes('openai') ? failure(429) : ok(ANTHROPIC_BODY);
    }) as unknown as typeof globalThis.fetch;

    const result = await runnerWith(fetchImpl).run(request);

    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.text).toContain('from the fallback');
    expect(calls[0]).toContain('api.openai.com');
    expect(calls[1]).toContain('api.anthropic.com');
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['fell_back', 'succeeded']);
  });

  it('falls back on 5xx and on a transport failure', async () => {
    for (const primaryFailure of [
      async () => failure(503),
      async () => {
        throw new Error('socket hang up');
      },
    ]) {
      const fetchImpl = vi.fn(async (url: RequestInfo | URL) =>
        String(url).includes('openai') ? primaryFailure() : ok(ANTHROPIC_BODY),
      ) as unknown as typeof globalThis.fetch;

      const result = await runnerWith(fetchImpl).run(request);
      expect(result.model).toBe('claude-haiku-4-5');
    }
  });

  it('does not fall back on a non-retryable error, because a bad request fails the same way twice', async () => {
    const fetchImpl = vi.fn(async () => failure(400)) as unknown as typeof globalThis.fetch;

    await expect(runnerWith(fetchImpl).run(request)).rejects.toThrow(ExtractionProviderError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back when the primary vendor refuses the key rather than the request', async () => {
    // A revoked key, a suspended account or a spent balance is not retryable against the
    // same vendor, but it is not evidence about the other one. Treating it as terminal
    // took every checkpoint down between a key rotation and the deploy carrying the new
    // one, while a plain 429 on the same key degraded to Haiku.
    for (const status of [401, 402, 403]) {
      const calls: string[] = [];
      const fetchImpl = vi.fn(async (url: RequestInfo | URL) => {
        calls.push(String(url));
        return String(url).includes('openai') ? failure(status) : ok(ANTHROPIC_BODY);
      }) as unknown as typeof globalThis.fetch;

      const result = await runnerWith(fetchImpl).run(request);

      expect(result.model).toBe('claude-haiku-4-5');
      expect(calls[1]).toContain('api.anthropic.com');
      expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['fell_back', 'succeeded']);
    }
  });

  it('still fails terminally when the key is refused and there is no fallback', async () => {
    const fetchImpl = vi.fn(async () => failure(401)) as unknown as typeof globalThis.fetch;

    await expect(runnerWith(fetchImpl, { fallbackModel: null }).run(request)).rejects.toThrow(
      ExtractionRunError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('records both attempts when the fallback also fails, so the ledger shows what was spent', async () => {
    const fetchImpl = vi.fn(async () => failure(500)) as unknown as typeof globalThis.fetch;
    const runner = runnerWith(fetchImpl);

    await expect(runner.run(request)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('carries billable attempts on the terminal rejection when both providers fail', async () => {
    const fetchImpl = vi.fn(async () => failure(500)) as unknown as typeof globalThis.fetch;
    const runner = runnerWith(fetchImpl);

    const error = await runner.run(request).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ExtractionRunError);
    expect(error).toMatchObject({
      attempts: [{ outcome: 'fell_back' }, { outcome: 'failed' }],
    });
  });

  it('can be configured with no fallback at all', async () => {
    const fetchImpl = vi.fn(async () => failure(503)) as unknown as typeof globalThis.fetch;
    const runner = runnerWith(fetchImpl, { fallbackModel: null });

    expect(runner.fallback).toBeNull();
    await expect(runner.run(request)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reports the window both models can serve, not the larger one', () => {
    const fetchImpl = vi.fn(async () => ok(OPENAI_BODY)) as unknown as typeof globalThis.fetch;

    expect(runnerWith(fetchImpl).servableContextTokens).toBe(200_000);
    expect(runnerWith(fetchImpl, { fallbackModel: null }).servableContextTokens).toBe(1_050_000);
  });

  it('does not try a fallback that cannot hold the prompt, and says why', async () => {
    const fetchImpl = vi.fn(async () => failure(429)) as unknown as typeof globalThis.fetch;
    const runner = runnerWith(fetchImpl);
    const oversized = {
      system: 'system',
      user: Array.from({ length: 400_000 }, () => 'settled').join(' '),
      maxOutputTokens: 4096,
    };

    await expect(runner.run(oversized)).rejects.toThrow(
      /claude-haiku-4-5 was not tried.*200,000 token window/s,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('marks the primary failed rather than fell_back when the fallback cannot fit', async () => {
    const fetchImpl = vi.fn(async () => failure(429)) as unknown as typeof globalThis.fetch;
    const runner = runnerWith(fetchImpl);
    const oversized = {
      system: 'system',
      user: Array.from({ length: 400_000 }, () => 'settled').join(' '),
      maxOutputTokens: 4096,
    };

    const error = await runner.run(oversized).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ExtractionProviderError);
    expect((error as { retryable: boolean }).retryable).toBe(false);
  });

  it('sends each vendor its own credential and auth header', async () => {
    const headers: Record<string, string>[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return String(url).includes('openai') ? failure(429) : ok(ANTHROPIC_BODY);
    }) as unknown as typeof globalThis.fetch;

    await runnerWith(fetchImpl).run(request);

    expect(headers[0]?.authorization).toBe('Bearer openai-key');
    expect(headers[1]?.['x-api-key']).toBe('anthropic-key');
    expect(headers[1]?.['anthropic-version']).toBe('2023-06-01');
  });
});

describe('cost controls on the OpenAI request body', () => {
  // Captures what was actually sent, because every setting below is a price decision
  // and a silently dropped field costs money without failing anything.
  const capture = (
    responses: readonly Response[],
  ): { bodies: Record<string, unknown>[]; fetchImpl: typeof globalThis.fetch } => {
    const bodies: Record<string, unknown>[] = [];
    let call = 0;
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const response = responses[call] ?? responses[responses.length - 1];
      call += 1;
      if (response === undefined) {
        throw new Error('the fixture ran out of responses');
      }
      return response.clone();
    }) as unknown as typeof globalThis.fetch;
    return { bodies, fetchImpl };
  };

  const flexUnavailable = (): Response =>
    new Response(JSON.stringify({ error: { code: 'resource_unavailable' } }), { status: 429 });

  it('asks for flex and low reasoning by default, because both halve the bill', async () => {
    const { bodies, fetchImpl } = capture([ok(OPENAI_BODY)]);

    await runnerWith(fetchImpl).run(request);

    expect(bodies[0]?.service_tier).toBe('flex');
    expect(bodies[0]?.reasoning).toEqual({ effort: 'low' });
  });

  it('sends prompt_cache_key when the caller supplies one, and omits it otherwise', async () => {
    // The real caller passes `workspaceId:projectId`, which is two UUIDs and a separator -
    // 73 characters, and OpenAI 400s anything over 64. Stripping the punctuation leaves
    // exactly the 64 hex characters of the two ids, so the key stays traceable back to a
    // project instead of becoming a hash.
    const workspaceId = '019229b4-6f1a-7c3d-8e5f-2a1b3c4d5e6f';
    const projectId = '7f3e2d1c-4b5a-4968-9d0e-1f2a3b4c5d6e';
    const { bodies, fetchImpl } = capture([ok(OPENAI_BODY), ok(OPENAI_BODY)]);
    const runner = runnerWith(fetchImpl);

    await runner.run({ ...request, cacheKey: `${workspaceId}:${projectId}` });
    await runner.run(request);

    expect(bodies[0]?.prompt_cache_key).toBe(
      '019229b46f1a7c3d8e5f2a1b3c4d5e6f7f3e2d1c4b5a49689d0e1f2a3b4c5d6e',
    );
    expect(String(bodies[0]?.prompt_cache_key)).toHaveLength(64);
    expect(bodies[1]).not.toHaveProperty('prompt_cache_key');
  });

  it('truncates a cache key that is still too long after punctuation is stripped', async () => {
    const { bodies, fetchImpl } = capture([ok(OPENAI_BODY)]);

    await runnerWith(fetchImpl).run({ ...request, cacheKey: `${'a-'.repeat(80)}tail` });

    expect(String(bodies[0]?.prompt_cache_key)).toHaveLength(64);
  });

  it('retries on the standard tier when flex has no capacity', async () => {
    // A 429 carrying resource_unavailable is unbilled and means flex specifically was
    // full, so the same request at standard rates is worth one attempt.
    const { bodies, fetchImpl } = capture([flexUnavailable(), ok(OPENAI_BODY)]);

    const result = await runnerWith(fetchImpl).run(request);

    expect(result.model).toBe('gpt-5.6-luna');
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.service_tier).toBe('flex');
    expect(bodies[1]).not.toHaveProperty('service_tier');
  });

  it('does not retry a plain 429, which is an account rate limit flex cannot fix', async () => {
    // Retrying here would spend a second request that is certain to fail. The vendor
    // fallback is the right escape hatch, so the primary must fail through to it.
    const { bodies, fetchImpl } = capture([failure(429), ok(ANTHROPIC_BODY)]);

    const result = await runnerWith(fetchImpl).run(request);

    expect(result.model).toBe('claude-haiku-4-5');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty('service_tier');
  });
});
