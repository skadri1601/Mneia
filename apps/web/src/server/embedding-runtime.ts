import 'server-only';

import type { EmbeddingProvider } from '@mneia/core';
import { createOpenAiEmbeddingProvider } from './embedding/openai.js';

let provider: EmbeddingProvider | null | undefined;

export const embeddingProvider = (): EmbeddingProvider | null => {
  if (provider !== undefined) {
    return provider;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    provider = null;
    return provider;
  }

  provider = createOpenAiEmbeddingProvider({
    apiKey,
    ...(process.env.MNEIA_EMBEDDING_MODEL === undefined
      ? {}
      : { model: process.env.MNEIA_EMBEDDING_MODEL }),
  });
  return provider;
};
