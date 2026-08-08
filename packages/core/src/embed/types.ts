import type { Embedding } from '../domain/types.js';
import { EMBEDDING_DIMENSIONS } from '../store/schema.js';

export type EmbeddingErrorCode =
  | 'invalid_input'
  | 'invalid_response'
  | 'dimension_mismatch'
  | 'provider_error';

export class EmbeddingError extends Error {
  readonly code: EmbeddingErrorCode;

  constructor(code: EmbeddingErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'EmbeddingError';
    this.code = code;
  }
}

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): Promise<readonly Embedding[]>;
}

export function assertEmbeddingDimensions(embedding: Embedding, model: string): Embedding {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingError(
      'dimension_mismatch',
      `expected ${model} to produce vectors of ${EMBEDDING_DIMENSIONS} components; received ${embedding.length} — ` +
        `context_item_embedding stores vector(${EMBEDDING_DIMENSIONS}), so configure a model of that width ` +
        'or migrate the column before switching',
    );
  }
  return embedding;
}

export function embeddableText(title: string, body: string | null): string {
  const trimmedTitle = title.trim();
  const trimmedBody = body === null ? '' : body.trim();

  if (trimmedTitle === '') return trimmedBody;
  if (trimmedBody === '') return trimmedTitle;
  return `${trimmedTitle}\n\n${trimmedBody}`;
}
