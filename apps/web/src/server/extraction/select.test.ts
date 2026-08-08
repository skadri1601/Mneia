import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createExtractionRunner } = await import('./select.js');
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

  it('records both attempts when the fallback also fails, so the ledger shows what was spent', async () => {
    const fetchImpl = vi.fn(async () => failure(500)) as unknown as typeof globalThis.fetch;
    const runner = runnerWith(fetchImpl);

    await expect(runner.run(request)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('can be configured with no fallback at all', async () => {
    const fetchImpl = vi.fn(async () => failure(503)) as unknown as typeof globalThis.fetch;
    const runner = runnerWith(fetchImpl, { fallbackModel: null });

    expect(runner.fallback).toBeNull();
    await expect(runner.run(request)).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
