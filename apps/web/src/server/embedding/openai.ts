import 'server-only';

import type { Embedding, EmbeddingProvider } from '@mneia/core';
import { assertEmbeddingDimensions, EMBEDDING_DIMENSIONS, EmbeddingError } from '@mneia/core';
import { z } from 'zod';

export const OPENAI_EMBEDDING_PROVIDER = 'openai';
export const DEFAULT_OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

export const EMBEDDING_MODELS: readonly string[] = [DEFAULT_OPENAI_EMBEDDING_MODEL];
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_EMBEDDING_BATCH_SIZE = 96;
export const DEFAULT_EMBEDDING_MAX_CONCURRENCY = 4;

const BODY_SNIPPET_LENGTH = 300;

export interface EmbeddingHttpResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init: {
    readonly method: string;
    readonly headers: Record<string, string>;
    readonly body: string;
  },
) => Promise<EmbeddingHttpResponse>;

export interface OpenAiEmbeddingProviderOptions {
  readonly apiKey: string;
  readonly model?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly fetch?: FetchLike | undefined;
  readonly batchSize?: number | undefined;
  readonly maxConcurrency?: number | undefined;
}

const EmbeddingsResponseSchema = z.object({
  data: z.array(
    z.object({
      index: z.number().int().min(0),
      embedding: z.array(z.number()),
    }),
  ),
});

const positiveInteger = (value: number | undefined, fallback: number, label: string): number => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new EmbeddingError(
      'invalid_input',
      `expected ${label} to be an integer of 1 or greater; received ${JSON.stringify(value)} — ` +
        `omit it to use the default of ${fallback}`,
    );
  }
  return value;
};

const chunked = (texts: readonly string[], size: number): readonly (readonly string[])[] => {
  const batches: (readonly string[])[] = [];
  for (let start = 0; start < texts.length; start += size) {
    batches.push(texts.slice(start, start + size));
  }
  return batches;
};

const runBounded = async <T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<readonly T[]> => {
  const results: (T | undefined)[] = Array.from({ length: tasks.length }, () => undefined);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (let index = cursor++; index < tasks.length; index = cursor++) {
      const task = tasks[index];
      if (task !== undefined) {
        results[index] = await task();
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));

  return results.map((result, index) => {
    if (result === undefined) {
      throw new EmbeddingError(
        'invalid_response',
        `expected a result for batch ${index} of ${tasks.length}; received none`,
      );
    }
    return result;
  });
};

const snippetOf = async (response: EmbeddingHttpResponse): Promise<string> => {
  let body: string;
  try {
    body = (await response.text()).trim();
  } catch (cause) {
    return `(body unreadable: ${cause instanceof Error ? cause.message : String(cause)})`;
  }
  if (body === '') return '(empty body)';
  return body.length > BODY_SNIPPET_LENGTH ? `${body.slice(0, BODY_SNIPPET_LENGTH)}…` : body;
};

export function createOpenAiEmbeddingProvider(
  options: OpenAiEmbeddingProviderOptions,
): EmbeddingProvider {
  const apiKey = options.apiKey.trim();
  if (apiKey === '') {
    throw new EmbeddingError(
      'invalid_input',
      'expected options.apiKey to hold an OpenAI API key; received an empty string — ' +
        'set OPENAI_API_KEY in the deployment environment',
    );
  }

  const model = (options.model ?? DEFAULT_OPENAI_EMBEDDING_MODEL).trim();
  if (!EMBEDDING_MODELS.includes(model)) {
    throw new EmbeddingError(
      'invalid_input',
      `expected options.model to name one of ${EMBEDDING_MODELS.join(', ')}; received ${JSON.stringify(model)} — ` +
        `stored vectors are keyed by model and only comparable against their own, so an unlisted model is refused rather than ` +
        `silently writing vectors nothing can rank against. Omit it to use ${DEFAULT_OPENAI_EMBEDDING_MODEL}`,
    );
  }

  const qualifiedModel = `${OPENAI_EMBEDDING_PROVIDER}:${model}`;
  const baseUrl = (options.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}/embeddings`;
  const batchSize = positiveInteger(options.batchSize, DEFAULT_EMBEDDING_BATCH_SIZE, 'batchSize');
  const maxConcurrency = positiveInteger(
    options.maxConcurrency,
    DEFAULT_EMBEDDING_MAX_CONCURRENCY,
    'maxConcurrency',
  );
  const send: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  const embedBatch = async (batch: readonly string[]): Promise<readonly Embedding[]> => {
    const response = await send(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: batch, encoding_format: 'float' }),
    });

    if (!response.ok) {
      throw new EmbeddingError(
        'provider_error',
        `expected a 2xx response from ${endpoint} for ${qualifiedModel}; received ${response.status} — ` +
          `${await snippetOf(response)}`,
      );
    }

    const parsed = EmbeddingsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new EmbeddingError(
        'invalid_response',
        `expected ${endpoint} to return { data: [{ index, embedding }] }; received a body that does not match — ` +
          `${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
        { cause: parsed.error },
      );
    }

    const ordered: (Embedding | undefined)[] = Array.from(
      { length: batch.length },
      () => undefined,
    );

    for (const entry of parsed.data.data) {
      if (entry.index >= batch.length) {
        throw new EmbeddingError(
          'invalid_response',
          `expected ${endpoint} to index its embeddings within a batch of ${batch.length}; received index ${entry.index}`,
        );
      }
      if (ordered[entry.index] !== undefined) {
        throw new EmbeddingError(
          'invalid_response',
          `expected ${endpoint} to return one embedding per input; received index ${entry.index} twice`,
        );
      }
      ordered[entry.index] = assertEmbeddingDimensions(entry.embedding, qualifiedModel);
    }

    return ordered.map((embedding, index) => {
      if (embedding === undefined) {
        throw new EmbeddingError(
          'invalid_response',
          `expected ${endpoint} to return an embedding for every input; received none at index ${index} of a batch of ${batch.length}`,
        );
      }
      return embedding;
    });
  };

  return {
    model: qualifiedModel,
    dimensions: EMBEDDING_DIMENSIONS,

    async embed(texts: readonly string[]): Promise<readonly Embedding[]> {
      if (texts.length === 0) return [];

      for (const [index, text] of texts.entries()) {
        if (text.trim() === '') {
          throw new EmbeddingError(
            'invalid_input',
            `expected every text to embed to hold content; received a blank one at index ${index} — ` +
              'drop the item or give it a title, because an empty input is rejected by the provider ' +
              'and would strand the batch',
          );
        }
      }

      const batches = chunked(texts, batchSize);
      const results = await runBounded(
        batches.map((batch) => () => embedBatch(batch)),
        maxConcurrency,
      );

      return results.flat();
    },
  };
}
