import 'server-only';

import type { ExtractionProvider, ExtractionProviderRequest } from '@mneia/core';

export type ExtractionVendor = 'openai' | 'anthropic';

export interface ExtractionModel {
  readonly id: string;
  readonly vendor: ExtractionVendor;
  readonly contextTokens: number;
}

export const EXTRACTION_MODELS: readonly ExtractionModel[] = [
  { id: 'gpt-5.6-luna', vendor: 'openai', contextTokens: 1_050_000 },
  { id: 'claude-haiku-4-5', vendor: 'anthropic', contextTokens: 200_000 },
];

export const DEFAULT_EXTRACTION_MODEL = 'gpt-5.6-luna';
export const DEFAULT_EXTRACTION_FALLBACK_MODEL = 'claude-haiku-4-5';

export class ExtractionProviderError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;
  /**
   * The vendor's own error code, when the body carried one.
   *
   * Status alone is not enough to tell failures apart: flex capacity exhaustion and an
   * account rate limit are both 429, and only the first is worth retrying on another
   * tier. See isFlexCapacityExhausted.
   */
  readonly code: string | null;

  constructor(
    message: string,
    options: { retryable: boolean; status?: number | null; code?: string | null; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ExtractionProviderError';
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.code = options.code ?? null;
  }
}

export const resolveExtractionModel = (id: string, variable: string): ExtractionModel => {
  const found = EXTRACTION_MODELS.find((model) => model.id === id);
  if (found === undefined) {
    throw new ExtractionProviderError(
      `expected ${variable} to name one of ${EXTRACTION_MODELS.map((model) => model.id).join(', ')}; received ${id} — an unrecognised model would bill against an account we have not sized, so it is refused at startup rather than passed through`,
      { retryable: false },
    );
  }
  return found;
};

const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

const isRetryableStatus = (status: number): boolean =>
  RETRYABLE_STATUS.has(status) || status >= 500;

/**
 * Statuses that condemn the vendor rather than the request.
 *
 * A revoked key, a suspended account or a spent balance is not retryable — the identical
 * call to the same vendor fails the same way — but it says nothing at all about the other
 * vendor, which is exactly the case the fallback exists for. Without this a rotated
 * OPENAI_API_KEY takes every checkpoint down until the deploy that replaces it, while a
 * plain rate limit on the same key degrades to Haiku. /api/health cannot tell them apart
 * either: it reports key_present for a key that no longer authenticates (MNE-266).
 */
const VENDOR_FATAL_STATUS = new Set([401, 402, 403]);

export const isVendorFatal = (error: unknown): boolean =>
  error instanceof ExtractionProviderError &&
  error.status !== null &&
  VENDOR_FATAL_STATUS.has(error.status);

const bodySnippet = (body: string): string => body.slice(0, 300).replace(/\s+/g, ' ').trim();

/**
 * Pulls the vendor's error code out of a failed response body.
 *
 * Both OpenAI and Anthropic wrap errors as `{"error": {...}}`; OpenAI names the machine
 * -readable value `code` and Anthropic names it `type`. Returns null for anything that is
 * not JSON in that shape, because an unparseable body is not an error code.
 */
const errorCodeOf = (body: string): string | null => {
  try {
    const parsed: unknown = JSON.parse(body);
    const error =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'error') : null;
    if (typeof error !== 'object' || error === null) {
      return null;
    }
    const code = Reflect.get(error, 'code') ?? Reflect.get(error, 'type');
    return typeof code === 'string' && code.length > 0 ? code : null;
  } catch {
    return null;
  }
};

/**
 * Whether a failure means flex had no capacity, as opposed to any other 429.
 *
 * The provider documents this as a 429 carrying error code "Resource Unavailable", and
 * states the request is not charged when it happens. An account rate limit is also a 429,
 * so matching on status alone would retry requests that are certain to fail again.
 * Normalised for case and separator because the docs and the wire format disagree on both.
 */
const isFlexCapacityExhausted = (error: ExtractionProviderError): boolean => {
  if (error.status !== 429 || error.code === null) {
    return false;
  }
  const normalised = error.code.toLowerCase().replaceAll(/[\s-]/g, '_');
  return normalised.includes('resource_unavailable');
};

/**
 * How hard the model thinks before answering.
 *
 * `gpt-5.6-luna` is a reasoning model and its default is `medium`. Reasoning tokens bill
 * as output, which is six times the input rate, so the default was the single largest
 * line of spend we had never asked for. Extraction is a structured read of a transcript
 * against a fixed schema rather than open-ended problem solving, so it does not need it.
 */
export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/**
 * Which processing tier the request runs on.
 *
 * `flex` bills at Batch API rates - half of standard on both input and output - while
 * still returning synchronously, and it stacks with prompt-cache discounts. The trade is
 * slower responses and occasional resource unavailability, which `extract` handles by
 * retrying once on the standard tier rather than failing the checkpoint.
 */
export const SERVICE_TIERS = ['auto', 'flex'] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'low';
export const DEFAULT_SERVICE_TIER: ServiceTier = 'flex';

export interface HttpExtractionOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number | undefined;
  readonly reasoningEffort?: ReasoningEffort | undefined;
  readonly serviceTier?: ServiceTier | undefined;
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function post(
  url: string,
  init: RequestInit,
  options: HttpExtractionOptions,
  vendor: ExtractionVendor,
): Promise<unknown> {
  const call = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await call(url, { ...init, signal: controller.signal });
  } catch (cause) {
    throw new ExtractionProviderError(
      `the ${vendor} extraction request to ${url} did not complete — the fallback provider handles this, and the trajectory is re-read on the next checkpoint rather than lost`,
      { retryable: true, cause },
    );
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new ExtractionProviderError(
      `expected 2xx from ${vendor} at ${url}; received ${response.status} with body "${bodySnippet(text)}"`,
      {
        retryable: isRetryableStatus(response.status),
        status: response.status,
        code: errorCodeOf(text),
      },
    );
  }

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new ExtractionProviderError(
      `expected JSON from ${vendor} at ${url}; the body did not parse — received "${bodySnippet(text)}"`,
      { retryable: false, cause },
    );
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNumber = (value: unknown): number => (typeof value === 'number' ? value : 0);

/**
 * OpenAI rejects a `prompt_cache_key` longer than 64 characters with a 400, which takes the
 * whole extraction down rather than degrading to an uncached call. `workspaceId:projectId`
 * is two UUIDs and a separator - 73 - so it failed every checkpoint in production between
 * the cacheKey landing and this fix.
 *
 * Stripping the punctuation out of two UUIDs leaves exactly 64 hex characters, so nothing
 * is lost for the key we actually send, and the ids stay legible in the provider dashboard
 * rather than being replaced by a hash nobody can trace back to a project. A longer key from
 * some future caller is truncated rather than sent: a fragmented cache costs money, while a
 * 400 costs the whole checkpoint.
 */
const OPENAI_MAX_CACHE_KEY_LENGTH = 64;

export const openAiCacheKey = (raw: string): string =>
  raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, OPENAI_MAX_CACHE_KEY_LENGTH);

export function createOpenAiExtractionProvider(options: HttpExtractionOptions): ExtractionProvider {
  const url = `${options.baseUrl ?? 'https://api.openai.com/v1'}/responses`;
  const reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  const configuredTier = options.serviceTier ?? DEFAULT_SERVICE_TIER;

  // Built per attempt so the flex retry can re-send an otherwise identical request on the
  // standard tier. Everything before the transcript is byte-stable by design, which is
  // what makes prompt_cache_key worth setting.
  const bodyFor = (request: ExtractionProviderRequest, tier: ServiceTier): string =>
    JSON.stringify({
      model: options.model,
      max_output_tokens: request.maxOutputTokens,
      input: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      text: { format: { type: 'json_object' } },
      reasoning: { effort: reasoningEffort },
      // 'auto' is the provider default; sending it explicitly is noise, so omit it.
      ...(tier === 'flex' ? { service_tier: 'flex' } : {}),
      ...(request.cacheKey === undefined
        ? {}
        : { prompt_cache_key: openAiCacheKey(request.cacheKey) }),
    });

  const send = async (request: ExtractionProviderRequest, tier: ServiceTier): Promise<unknown> =>
    post(
      url,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: bodyFor(request, tier),
      },
      options,
      'openai',
    );

  return {
    model: options.model,

    async extract(request: ExtractionProviderRequest) {
      let payload: unknown;
      // What actually served the response, which is not always what was configured. The
      // retry below silently doubles the rate, and only this function can see it happen.
      let servedTier: ServiceTier = configuredTier;

      if (configuredTier === 'flex') {
        try {
          payload = await send(request, 'flex');
        } catch (cause) {
          // Flex trades price for capacity, so it can refuse when none is free. Only that
          // specific failure is worth re-sending at standard rates: it is unbilled, and the
          // standard tier has capacity flex did not. Every other failure - a real rate
          // limit, a bad key, a malformed body - would fail the same way at twice the
          // price, so it is rethrown and the runner's vendor fallback decides what next.
          if (!(cause instanceof ExtractionProviderError) || !isFlexCapacityExhausted(cause)) {
            throw cause;
          }
          payload = await send(request, 'auto');
          servedTier = 'auto';
        }
      } else {
        payload = await send(request, configuredTier);
      }

      const record = asRecord(payload);
      const usage = asRecord(record?.usage);
      const text = collectOpenAiText(record);

      return {
        text,
        inputTokens: asNumber(usage?.input_tokens),
        outputTokens: asNumber(usage?.output_tokens),
        serviceTier: servedTier,
      };
    },
  };
}

function collectOpenAiText(record: Record<string, unknown> | null): string {
  const direct = record?.output_text;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }

  const output = record?.output;
  if (!Array.isArray(output)) {
    return '';
  }

  const parts: string[] = [];
  for (const entry of output) {
    const message = asRecord(entry);
    const content = message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const block of content) {
      const typed = asRecord(block);
      const text = typed?.text;
      if (typeof text === 'string') {
        parts.push(text);
      }
    }
  }
  return parts.join('');
}

export function createAnthropicExtractionProvider(
  options: HttpExtractionOptions,
): ExtractionProvider {
  const url = `${options.baseUrl ?? 'https://api.anthropic.com/v1'}/messages`;

  return {
    model: options.model,

    async extract(request: ExtractionProviderRequest) {
      const payload = await post(
        url,
        {
          method: 'POST',
          headers: {
            'x-api-key': options.apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            max_tokens: request.maxOutputTokens,
            system: request.system,
            messages: [{ role: 'user', content: request.user }],
          }),
        },
        options,
        'anthropic',
      );

      const record = asRecord(payload);
      const usage = asRecord(record?.usage);
      const content = record?.content;
      const parts: string[] = [];

      if (Array.isArray(content)) {
        for (const block of content) {
          const typed = asRecord(block);
          if (typed?.type === 'text' && typeof typed.text === 'string') {
            parts.push(typed.text);
          }
        }
      }

      return {
        text: parts.join(''),
        inputTokens: asNumber(usage?.input_tokens),
        outputTokens: asNumber(usage?.output_tokens),
      };
    },
  };
}
