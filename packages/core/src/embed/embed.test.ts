import { describe, expect, it } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../store/schema.js';
import {
  assertEmbeddingDimensions,
  EmbeddingError,
  type EmbeddingProvider,
  embeddableText,
} from './types.js';

const MODEL = 'openai:text-embedding-3-small';

const vectorOf = (length: number): number[] => new Array<number>(length).fill(0.5);

function refusal(run: () => unknown): EmbeddingError {
  try {
    run();
  } catch (error) {
    if (error instanceof EmbeddingError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an EmbeddingError, but the call returned');
}

describe('EmbeddingError', () => {
  it('carries a machine-readable code alongside the message', () => {
    const error = new EmbeddingError('provider_error', 'the provider said no');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('EmbeddingError');
    expect(error.code).toBe('provider_error');
    expect(error.message).toBe('the provider said no');
  });

  it('preserves the underlying cause', () => {
    const cause = new Error('socket hang up');
    const error = new EmbeddingError('provider_error', 'unreachable', { cause });

    expect(error.cause).toBe(cause);
  });
});

describe('assertEmbeddingDimensions', () => {
  it('returns the vector when it matches the stored width', () => {
    const embedding = vectorOf(EMBEDDING_DIMENSIONS);

    expect(assertEmbeddingDimensions(embedding, MODEL)).toBe(embedding);
  });

  it('refuses a vector that is too short', () => {
    const error = refusal(() => assertEmbeddingDimensions(vectorOf(768), MODEL));

    expect(error.code).toBe('dimension_mismatch');
    expect(error.message).toContain(MODEL);
    expect(error.message).toContain(String(EMBEDDING_DIMENSIONS));
    expect(error.message).toContain('768');
  });

  it('refuses a vector that is too long', () => {
    const error = refusal(() =>
      assertEmbeddingDimensions(vectorOf(EMBEDDING_DIMENSIONS + 1), MODEL),
    );

    expect(error.code).toBe('dimension_mismatch');
    expect(error.message).toContain(String(EMBEDDING_DIMENSIONS + 1));
  });

  it('refuses an empty vector rather than storing an unusable row', () => {
    expect(refusal(() => assertEmbeddingDimensions([], MODEL)).code).toBe('dimension_mismatch');
  });
});

describe('embeddableText', () => {
  it('joins the title and body with a blank line', () => {
    expect(embeddableText('Use Postgres', 'pgvector covers the ranking need')).toBe(
      'Use Postgres\n\npgvector covers the ranking need',
    );
  });

  it('returns the title alone when there is no body', () => {
    expect(embeddableText('Use Postgres', null)).toBe('Use Postgres');
  });

  it('returns the title alone when the body is only whitespace', () => {
    expect(embeddableText('Use Postgres', '   \n  ')).toBe('Use Postgres');
  });

  it('returns the body alone when the title is blank', () => {
    expect(embeddableText('  ', 'pgvector covers the ranking need')).toBe(
      'pgvector covers the ranking need',
    );
  });

  it('trims both sides so padding does not change the vector', () => {
    expect(embeddableText('  Use Postgres  ', '  pgvector  ')).toBe('Use Postgres\n\npgvector');
  });

  it('produces an empty string when there is nothing to embed', () => {
    expect(embeddableText('', null)).toBe('');
  });
});

describe('EmbeddingProvider', () => {
  it('is satisfiable without naming a vendor, and records the model it used', async () => {
    const provider: EmbeddingProvider = {
      model: MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
      embed: async (texts) => texts.map(() => vectorOf(EMBEDDING_DIMENSIONS)),
    };

    const embeddings = await provider.embed(['a', 'b']);

    expect(provider.model).toMatch(/^[a-z0-9-]+:.+$/);
    expect(provider.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(embeddings).toHaveLength(2);
    expect(embeddings[0]).toHaveLength(EMBEDDING_DIMENSIONS);
  });
});
