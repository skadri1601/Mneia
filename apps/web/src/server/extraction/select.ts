import 'server-only';

import {
  defaultTokenCounter,
  type ExtractionProvider,
  type ExtractionProviderRequest,
} from '@mneia/core';
import {
  createAnthropicExtractionProvider,
  createOpenAiExtractionProvider,
  DEFAULT_EXTRACTION_FALLBACK_MODEL,
  DEFAULT_EXTRACTION_MODEL,
  type ExtractionModel,
  ExtractionProviderError,
  type HttpExtractionOptions,
  isVendorFatal,
  type ReasoningEffort,
  resolveExtractionModel,
  type ServiceTier,
} from './providers.js';

/**
 * What a failed call was billed, when the vendor answered before failing.
 *
 * Most failures cost nothing — a timeout, a refused connection, a 4xx. A truncated response
 * is the exception and the expensive one, so the tokens ride on the error rather than being
 * assumed away.
 */
const billedInputTokens = (error: unknown): number =>
  error instanceof ExtractionProviderError ? error.inputTokens : 0;

const billedOutputTokens = (error: unknown): number =>
  error instanceof ExtractionProviderError ? error.outputTokens : 0;

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

export class ExtractionRunError extends ExtractionProviderError {
  readonly attempts: readonly ExtractionAttempt[];

  constructor(error: unknown, attempts: readonly ExtractionAttempt[]) {
    const providerError = error instanceof ExtractionProviderError ? error : null;
    super(
      error instanceof Error ? error.message : String(error),
      providerError === null
        ? { retryable: false, cause: error }
        : { retryable: providerError.retryable, status: providerError.status, cause: error },
    );
    this.name = 'ExtractionRunError';
    this.attempts = [...attempts];
  }
}

export interface ExtractionRunner {
  readonly primary: string;
  readonly fallback: string | null;
  readonly servableContextTokens: number;
  run(request: ExtractionProviderRequest): Promise<ExtractionRunResult>;
}

const estimatePromptTokens = (request: ExtractionProviderRequest): number =>
  defaultTokenCounter.count(request.system) + defaultTokenCounter.count(request.user);

const fitsWindow = (request: ExtractionProviderRequest, model: ExtractionModel): boolean =>
  estimatePromptTokens(request) + (request.maxOutputTokens ?? 0) <= model.contextTokens;

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
  /** Overrides the provider default of `low`. See ReasoningEffort in providers.ts. */
  readonly reasoningEffort?: ReasoningEffort | undefined;
  /** Overrides the provider default of `flex`. See ServiceTier in providers.ts. */
  readonly serviceTier?: ServiceTier | undefined;
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
      reasoningEffort: options.reasoningEffort,
      serviceTier: options.serviceTier,
    });

  return {
    primary: primary.id,
    fallback: fallback === null ? null : fallback.id,
    servableContextTokens:
      fallback === null
        ? primary.contextTokens
        : Math.min(primary.contextTokens, fallback.contextTokens),

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
        // Two different reasons to reach for the other vendor: this request might succeed
        // on a second attempt, or this vendor is refusing everything we send it.
        const worthFallingBack = retryable || isVendorFatal(error);
        const fits = fallback === null ? false : fitsWindow(request, fallback);
        // Not always zero: a truncated response is billed in full, and those are the calls
        // that spent the whole output ceiling. Zeroing them here hid the most expensive
        // requests we make from checkpoint_usage whenever the fallback then succeeded.
        attempts.push({
          model: primary.id,
          outcome: worthFallingBack && fallback !== null && fits ? 'fell_back' : 'failed',
          inputTokens: billedInputTokens(error),
          outputTokens: billedOutputTokens(error),
          durationMs: now() - startedAt,
        });

        if (!worthFallingBack || fallback === null) {
          throw new ExtractionRunError(error, attempts);
        }

        if (!fits) {
          throw new ExtractionRunError(
            new ExtractionProviderError(
              `${primary.id} failed and ${fallback.id} was not tried: the prompt is about ${estimatePromptTokens(request).toLocaleString()} tokens against its ${fallback.contextTokens.toLocaleString()} token window. Nothing was written and the trajectory is unconsumed, so it is re-read on the next checkpoint. The primary failed with: ${error instanceof Error ? error.message : String(error)}`,
              { retryable: false, cause: error },
            ),
            attempts,
          );
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
            inputTokens: billedInputTokens(fallbackError),
            outputTokens: billedOutputTokens(fallbackError),
            durationMs: now() - fallbackStartedAt,
          });
          throw new ExtractionRunError(fallbackError, attempts);
        }
      }
    },
  };
}
