import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { EMBEDDING_DIMENSIONS, EmbeddingError } from '@mneia/core';
import { z } from 'zod';
import {
  createOpenAiEmbeddingProvider,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  type EmbeddingHttpResponse,
  type FetchLike,
} from './openai.js';

const API_KEY = 'sk-test-000000000000';

const RequestBodySchema = z.object({
  model: z.string(),
  input: z.array(z.string()),
  encoding_format: z.string(),
});

const requestOf = (body: string): { model: string; input: string[]; encoding_format: string } =>
  RequestBodySchema.parse(JSON.parse(body));

const vectorOf = (seed: number, length = EMBEDDING_DIMENSIONS): number[] => {
  const vector = new Array<number>(length).fill(0);
  vector[0] = seed;
  return vector;
};

const jsonResponse = (payload: unknown, status = 200): EmbeddingHttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

const textResponse = (status: number, body: string): EmbeddingHttpResponse => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => JSON.parse(body),
  text: async () => body,
});

const echoingFetch = (): { fetch: FetchLike; calls: { url: string; input: string[] }[] } => {
  const calls: { url: string; input: string[] }[] = [];
  const fetch: FetchLike = async (url, init) => {
    const request = requestOf(init.body);
    calls.push({ url, input: request.input });
    return jsonResponse({
      data: request.input.map((text, index) => ({
        index,
        embedding: vectorOf(Number(text)),
      })),
    });
  };
  return { fetch, calls };
};

const numbered = (count: number): string[] =>
  Array.from({ length: count }, (_unused, index) => String(index));

async function refusal(run: () => Promise<unknown>): Promise<EmbeddingError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an EmbeddingError, but the call resolved');
}

describe('createOpenAiEmbeddingProvider', () => {
  it('reports the provider-qualified model id the store records alongside the vector', () => {
    const provider = createOpenAiEmbeddingProvider({ apiKey: API_KEY });

    expect(provider.model).toBe('openai:text-embedding-3-small');
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
  });

  it('qualifies an overridden model too', () => {
    const provider = createOpenAiEmbeddingProvider({
      apiKey: API_KEY,
      model: 'text-embedding-3-large',
    });

    expect(provider.model).toBe('openai:text-embedding-3-large');
  });

  it('sends the unqualified model name and the bearer token to the embeddings endpoint', async () => {
    const seen: { url: string; headers: Record<string, string>; model: string }[] = [];
    const fetch: FetchLike = async (url, init) => {
      seen.push({ url, headers: init.headers, model: requestOf(init.body).model });
      return jsonResponse({ data: [{ index: 0, embedding: vectorOf(1) }] });
    };

    await createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['one']);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/embeddings');
    expect(seen[0]?.model).toBe('text-embedding-3-small');
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${API_KEY}`);
  });

  it('honours a custom base url without doubling its slash', async () => {
    const { fetch, calls } = echoingFetch();

    await createOpenAiEmbeddingProvider({
      apiKey: API_KEY,
      fetch,
      baseUrl: 'https://gateway.internal/v1/',
    }).embed(['1']);

    expect(calls[0]?.url).toBe('https://gateway.internal/v1/embeddings');
  });
});

describe('batching', () => {
  it('sends 200 texts as three requests at a batch size of 96, never one per text', async () => {
    const { fetch, calls } = echoingFetch();

    const embeddings = await createOpenAiEmbeddingProvider({
      apiKey: API_KEY,
      fetch,
      batchSize: 96,
      maxConcurrency: 1,
    }).embed(numbered(200));

    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.input.length)).toEqual([96, 96, 8]);
    expect(embeddings).toHaveLength(200);
  });

  it('defaults to a batch size of 96', async () => {
    const { fetch, calls } = echoingFetch();

    await createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(numbered(100));

    expect(DEFAULT_EMBEDDING_BATCH_SIZE).toBe(96);
    expect(calls.map((call) => call.input.length)).toEqual([96, 4]);
  });

  it('makes no request at all for an empty input', async () => {
    const { fetch, calls } = echoingFetch();

    const embeddings = await createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed([]);

    expect(embeddings).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('ordering', () => {
  it('places each embedding by its response index, not by arrival order', async () => {
    const fetch: FetchLike = async (_url, init) => {
      const { input } = requestOf(init.body);
      const shuffled = input
        .map((text, index) => ({ index, embedding: vectorOf(Number(text)) }))
        .reverse();
      return jsonResponse({ data: shuffled });
    };

    const embeddings = await createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(
      numbered(5),
    );

    expect(embeddings.map((embedding) => embedding[0])).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps input order across batches that complete out of order', async () => {
    const fetch: FetchLike = async (_url, init) => {
      const { input } = requestOf(init.body);
      const first = input[0] ?? '0';
      await new Promise((resolve) => setTimeout(resolve, Number(first) === 0 ? 20 : 0));
      return jsonResponse({
        data: input
          .map((text, index) => ({ index, embedding: vectorOf(Number(text)) }))
          .sort((a, b) => b.index - a.index),
      });
    };

    const embeddings = await createOpenAiEmbeddingProvider({
      apiKey: API_KEY,
      fetch,
      batchSize: 2,
      maxConcurrency: 4,
    }).embed(numbered(8));

    expect(embeddings.map((embedding) => embedding[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('concurrency', () => {
  it('never exceeds the configured cap, so a large backfill does not open a socket per batch', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetch: FetchLike = async (_url, init) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const { input } = requestOf(init.body);
      return jsonResponse({
        data: input.map((text, index) => ({ index, embedding: vectorOf(Number(text)) })),
      });
    };

    const embeddings = await createOpenAiEmbeddingProvider({
      apiKey: API_KEY,
      fetch,
      batchSize: 1,
      maxConcurrency: 3,
    }).embed(numbered(20));

    expect(peak).toBe(3);
    expect(embeddings).toHaveLength(20);
  });

  it('runs a single batch at a time when the cap is one', async () => {
    let inFlight = 0;
    let peak = 0;
    const fetch: FetchLike = async (_url, init) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      const { input } = requestOf(init.body);
      return jsonResponse({
        data: input.map((text, index) => ({ index, embedding: vectorOf(Number(text)) })),
      });
    };

    await createOpenAiEmbeddingProvider({
      apiKey: API_KEY,
      fetch,
      batchSize: 1,
      maxConcurrency: 1,
    }).embed(numbered(4));

    expect(peak).toBe(1);
  });
});

describe('failures', () => {
  it('refuses a vector whose width does not match the stored column', async () => {
    const fetch: FetchLike = async () =>
      jsonResponse({ data: [{ index: 0, embedding: vectorOf(1, 768) }] });

    const error = await refusal(() =>
      createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['one']),
    );

    expect(error.code).toBe('dimension_mismatch');
    expect(error.message).toContain('openai:text-embedding-3-small');
    expect(error.message).toContain(String(EMBEDDING_DIMENSIONS));
    expect(error.message).toContain('768');
  });

  it('names the status and a body snippet on a non-2xx response', async () => {
    const fetch: FetchLike = async () =>
      textResponse(429, '{"error":{"message":"Rate limit reached for text-embedding-3-small"}}');

    const error = await refusal(() =>
      createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['one']),
    );

    expect(error.code).toBe('provider_error');
    expect(error.message).toContain('429');
    expect(error.message).toContain('https://api.openai.com/v1/embeddings');
    expect(error.message).toContain('Rate limit reached');
  });

  it('truncates a very long error body rather than logging the whole thing', async () => {
    const fetch: FetchLike = async () => textResponse(500, 'x'.repeat(5_000));

    const error = await refusal(() =>
      createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['one']),
    );

    expect(error.message.length).toBeLessThan(600);
    expect(error.message).toContain('…');
  });

  it('refuses a response whose shape does not match', async () => {
    const fetch: FetchLike = async () => jsonResponse({ data: [{ embedding: 'not-a-vector' }] });

    const error = await refusal(() =>
      createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['one']),
    );

    expect(error.code).toBe('invalid_response');
  });

  it('refuses a response that omits an embedding for one of the inputs', async () => {
    const fetch: FetchLike = async () =>
      jsonResponse({ data: [{ index: 0, embedding: vectorOf(0) }] });

    const error = await refusal(() =>
      createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['zero', 'one']),
    );

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('index 1');
  });

  it('refuses a response that repeats an index', async () => {
    const fetch: FetchLike = async () =>
      jsonResponse({
        data: [
          { index: 0, embedding: vectorOf(0) },
          { index: 0, embedding: vectorOf(1) },
        ],
      });

    const error = await refusal(() =>
      createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['zero', 'one']),
    );

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('twice');
  });

  it('refuses a blank text before it strands a whole batch at the provider', async () => {
    const { fetch, calls } = echoingFetch();

    const error = await refusal(() =>
      createOpenAiEmbeddingProvider({ apiKey: API_KEY, fetch }).embed(['1', '  ']),
    );

    expect(error.code).toBe('invalid_input');
    expect(error.message).toContain('index 1');
    expect(calls).toHaveLength(0);
  });

  it('refuses an empty api key', () => {
    expect(() => createOpenAiEmbeddingProvider({ apiKey: '   ' })).toThrow(EmbeddingError);
  });

  it('refuses a batch size that would disable batching', () => {
    expect(() => createOpenAiEmbeddingProvider({ apiKey: API_KEY, batchSize: 0 })).toThrow(
      /batchSize/,
    );
  });

  it('refuses an unbounded concurrency setting', () => {
    expect(() => createOpenAiEmbeddingProvider({ apiKey: API_KEY, maxConcurrency: 0 })).toThrow(
      /maxConcurrency/,
    );
  });
});
