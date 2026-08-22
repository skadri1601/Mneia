import 'server-only';

import { database } from './database.js';
import {
  ExtractionProviderError,
  REASONING_EFFORTS,
  SERVICE_TIERS,
} from './extraction/providers.js';
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

/**
 * Reads one of a fixed set of values from the environment, or fails at startup.
 *
 * These two settings move real money - reasoning effort and service tier are together
 * most of the extraction bill - so a typo must not silently fall back to the expensive
 * default. Unset is fine and takes the provider default; misspelled is refused.
 */
const oneOf = <T extends string>(
  name: string,
  allowed: readonly T[],
  raw: string | undefined,
): T | undefined => {
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const value = raw.trim();
  if (!(allowed as readonly string[]).includes(value)) {
    throw new ExtractionProviderError(
      `expected ${name} to be one of ${allowed.join(', ')}; received ${JSON.stringify(value)} — ` +
        'unset it to use the default rather than guessing, because this setting decides what a ' +
        'checkpoint costs',
      { retryable: false },
    );
  }
  return value as T;
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
    // Point these at a Cloudflare AI Gateway endpoint to get unified cost analytics,
    // request logging and retries across both vendors. Unset, both providers talk to the
    // vendor directly, which is the current production behaviour.
    openaiBaseUrl: process.env.MNEIA_OPENAI_BASE_URL,
    anthropicBaseUrl: process.env.MNEIA_ANTHROPIC_BASE_URL,
    reasoningEffort: oneOf(
      'MNEIA_EXTRACTION_REASONING_EFFORT',
      REASONING_EFFORTS,
      process.env.MNEIA_EXTRACTION_REASONING_EFFORT,
    ),
    serviceTier: oneOf(
      'MNEIA_EXTRACTION_SERVICE_TIER',
      SERVICE_TIERS,
      process.env.MNEIA_EXTRACTION_SERVICE_TIER,
    ),
  });
  return runner;
};

export const checkpointSourceStore = (): CheckpointSourceStore => {
  sourceStore ??= new CheckpointSourceStore(database);
  return sourceStore;
};
