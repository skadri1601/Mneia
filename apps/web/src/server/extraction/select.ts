import 'server-only';

import type { ExtractionProvider, ExtractionProviderRequest } from '@mneia/core';
import {
  createAnthropicExtractionProvider,
  createOpenAiExtractionProvider,
  DEFAULT_EXTRACTION_FALLBACK_MODEL,
  DEFAULT_EXTRACTION_MODEL,
  type ExtractionModel,
  ExtractionProviderError,
  type HttpExtractionOptions,
  resolveExtractionModel,
} from './providers.js';

export interface ExtractionAttempt {
  readonly model: string;
  readonly outcome: 'succeeded' | 'failed' | 'fell_back';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
}

export interface ExtractionRunResult {
  readonly text: string;
  readonly model: string;
  readonly attempts: readonly ExtractionAttempt[];
}

export interface ExtractionRunner {
  readonly primary: string;
  readonly fallback: string | null;
  run(request: ExtractionProviderRequest): Promise<ExtractionRunResult>;
}

const providerFor = (
  model: ExtractionModel,
  options: Omit<HttpExtractionOptions, 'model'> & { readonly anthropicApiKey?: string | undefined },
): ExtractionProvider => {
  if (model.vendor === 'anthropic') {
    return createAnthropicExtractionProvider({
      ...options,
      apiKey: options.anthropicApiKey ?? options.apiKey,
      model: model.id,
    });
  }
  return createOpenAiExtractionProvider({ ...options, model: model.id });
};

export interface ExtractionRunnerOptions {
  readonly openaiApiKey: string;
  readonly anthropicApiKey?: string | undefined;
  readonly primaryModel?: string | undefined;
  readonly fallbackModel?: string | null | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly openaiBaseUrl?: string | undefined;
  readonly anthropicBaseUrl?: string | undefined;
  readonly now?: () => number;
}

export function createExtractionRunner(options: ExtractionRunnerOptions): ExtractionRunner {
  const primary = resolveExtractionModel(
    options.primaryModel ?? DEFAULT_EXTRACTION_MODEL,
    'MNEIA_EXTRACTION_MODEL',
  );
  const fallbackId =
    options.fallbackModel === null
      ? null
      : (options.fallbackModel ?? DEFAULT_EXTRACTION_FALLBACK_MODEL);
  const fallback =
    fallbackId === null
      ? null
      : resolveExtractionModel(fallbackId, 'MNEIA_EXTRACTION_FALLBACK_MODEL');

  const now = options.now ?? (() => Date.now());

  const build = (model: ExtractionModel): ExtractionProvider =>
    providerFor(model, {
      apiKey: options.openaiApiKey,
      anthropicApiKey: options.anthropicApiKey,
      fetch: options.fetch,
      baseUrl: model.vendor === 'anthropic' ? options.anthropicBaseUrl : options.openaiBaseUrl,
    });

  return {
    primary: primary.id,
    fallback: fallback === null ? null : fallback.id,

    async run(request: ExtractionProviderRequest): Promise<ExtractionRunResult> {
      const attempts: ExtractionAttempt[] = [];
      const startedAt = now();

      try {
        const response = await build(primary).extract(request);
        attempts.push({
          model: primary.id,
          outcome: 'succeeded',
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          durationMs: now() - startedAt,
        });
        return { text: response.text, model: primary.id, attempts };
      } catch (error) {
        const retryable = error instanceof ExtractionProviderError && error.retryable;
        attempts.push({
          model: primary.id,
          outcome: retryable && fallback !== null ? 'fell_back' : 'failed',
          inputTokens: 0,
          outputTokens: 0,
          durationMs: now() - startedAt,
        });

        if (!retryable || fallback === null) {
          throw error;
        }

        const fallbackStartedAt = now();
        try {
          const response = await build(fallback).extract(request);
          attempts.push({
            model: fallback.id,
            outcome: 'succeeded',
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            durationMs: now() - fallbackStartedAt,
          });
          return { text: response.text, model: fallback.id, attempts };
        } catch (fallbackError) {
          attempts.push({
            model: fallback.id,
            outcome: 'failed',
            inputTokens: 0,
            outputTokens: 0,
            durationMs: now() - fallbackStartedAt,
          });
          throw fallbackError;
        }
      }
    },
  };
}
