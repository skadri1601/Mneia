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
  SERVICE_TIERS,
  type ServiceTier,
} from './providers.js';

export interface ExtractionAttempt {
  readonly model: string;
  readonly outcome: 'succeeded' | 'failed' | 'fell_back';
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  /**
   * The tier that served this attempt, when the provider reported one.
   *
   * Absent for a vendor without tiers, and for a failed attempt that never got a response.
   * The caller falls back to the configured tier — reported beats configured, because a
   * flex request with no capacity is re-sent at standard rates and costs twice what the
   * configuration implies.
   */
  readonly serviceTier?: ServiceTier | undefined;
}

/**
 * Narrow what a provider reported to a tier we can price.
 *
 * A provider is free to report anything; only the tiers in the pricing table may reach the
 * ledger, and an unrecognised one falls back to the configured tier rather than being
 * carried through as a value `costMicrosFor` would refuse.
 */
const reportedTier = (value: string | undefined): ServiceTier | undefined =>
  SERVICE_TIERS.find((tier) => tier === value);

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
          serviceTier: reportedTier(response.serviceTier),
        });
        return { text: response.text, model: primary.id, attempts };
      } catch (error) {
        const retryable = error instanceof ExtractionProviderError && error.retryable;
        // Two different reasons to reach for the other vendor: this request might succeed
        // on a second attempt, or this vendor is refusing everything we send it.
        const worthFallingBack = retryable || isVendorFatal(error);
        const fits = fallback === null ? false : fitsWindow(request, fallback);
        attempts.push({
          model: primary.id,
          outcome: worthFallingBack && fallback !== null && fits ? 'fell_back' : 'failed',
          inputTokens: 0,
          outputTokens: 0,
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
            serviceTier: reportedTier(response.serviceTier),
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
          throw new ExtractionRunError(fallbackError, attempts);
        }
      }
    },
  };
}
