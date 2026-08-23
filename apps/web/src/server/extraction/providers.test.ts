import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createOpenAiExtractionProvider, openAiCacheKey } = await import('./providers.js');

const WORKSPACE = '874090eb-c7bc-49ef-b653-93e24148a92c';
const PROJECT = '4484a9ea-851a-4e26-800c-1a13ee4bd5f0';

describe('openAiCacheKey', () => {
  // propose.ts sends `${workspaceId}:${project.id}`, which is 73 characters. OpenAI rejects
  // anything over 64 with a 400, and that 400 fails the whole extraction rather than
  // degrading to an uncached call — every checkpoint in production failed on it.
  it('brings a workspace and project pair under the 64-character provider limit', () => {
    const raw = `${WORKSPACE}:${PROJECT}`;

    expect(raw.length).toBe(73);
    expect(openAiCacheKey(raw).length).toBeLessThanOrEqual(64);
  });

  it('loses nothing from a pair of uuids, so two projects never share a key', () => {
    const first = openAiCacheKey(`${WORKSPACE}:${PROJECT}`);
    const sibling = openAiCacheKey(`${WORKSPACE}:4484a9ea-851a-4e26-800c-1a13ee4bd5f1`);

    expect(first.length).toBe(64);
    expect(first).not.toBe(sibling);
  });

  it('is stable, because a key that varies per call caches nothing', () => {
    expect(openAiCacheKey(`${WORKSPACE}:${PROJECT}`)).toBe(
      openAiCacheKey(`${WORKSPACE}:${PROJECT}`),
    );
  });

  it('truncates a longer key rather than sending one the provider will refuse', () => {
    expect(openAiCacheKey('x'.repeat(200)).length).toBe(64);
  });
});

describe('an openai response that ran out of output budget', () => {
  const respondWith = (body: unknown) =>
    createOpenAiExtractionProvider({
      apiKey: 'sk-test',
      model: 'gpt-5.6-luna',
      serviceTier: 'auto',
      fetch: (async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as typeof globalThis.fetch,
    });

  const request = { system: 'system', user: 'user', maxOutputTokens: 8192 };

  // A reasoning model bills thinking against max_output_tokens, so it can spend the whole
  // ceiling before writing a message. Read as an empty string this surfaced downstream as
  // "not valid JSON" — thrown outside the run-level catch, so the fallback never fired.
  it('is reported as a truncation, naming the reason and the ceiling', async () => {
    const provider = respondWith({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning' }],
      output_text: '',
      usage: { input_tokens: 41_000, output_tokens: 8192 },
    });

    await expect(provider.extract(request)).rejects.toThrow(
      /stopped at status "incomplete" \(max_output_tokens\) after 8192 output tokens against a 8192 token ceiling/,
    );
  });

  it('is retryable, so the fallback vendor is actually tried', async () => {
    const provider = respondWith({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: '',
      usage: { input_tokens: 10, output_tokens: 8192 },
    });

    await expect(provider.extract(request)).rejects.toMatchObject({
      name: 'ExtractionProviderError',
      retryable: true,
      code: 'max_output_tokens',
    });
  });

  it('leaves a completed empty answer alone, because {"candidates":[]} is a real result', async () => {
    const provider = respondWith({
      status: 'completed',
      output_text: '{"candidates":[]}',
      usage: { input_tokens: 10, output_tokens: 7 },
    });

    await expect(provider.extract(request)).resolves.toMatchObject({
      text: '{"candidates":[]}',
    });
  });
});
