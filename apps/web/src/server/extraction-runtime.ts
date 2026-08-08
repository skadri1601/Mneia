import 'server-only';

import { database } from './database.js';
import { ExtractionProviderError } from './extraction/providers.js';
import { createExtractionRunner, type ExtractionRunner } from './extraction/select.js';
import { CheckpointSourceStore } from './store/checkpoint-source-store.js';

let runner: ExtractionRunner | undefined;
let sourceStore: CheckpointSourceStore | undefined;

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new ExtractionProviderError(
      `expected ${name} to be set so checkpoint can reach a model; it is missing — see deploy/web.env.example, and restart the service after setting it because the app reads process.env at runtime`,
      { retryable: false },
    );
  }
  return value;
};

export const extractionRunner = (): ExtractionRunner => {
  runner ??= createExtractionRunner({
    openaiApiKey: required('OPENAI_API_KEY'),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    primaryModel: process.env.MNEIA_EXTRACTION_MODEL,
    fallbackModel:
      process.env.ANTHROPIC_API_KEY === undefined
        ? null
        : process.env.MNEIA_EXTRACTION_FALLBACK_MODEL,
  });
  return runner;
};

export const checkpointSourceStore = (): CheckpointSourceStore => {
  sourceStore ??= new CheckpointSourceStore(database);
  return sourceStore;
};
