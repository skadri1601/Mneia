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

  constructor(
    message: string,
    options: { retryable: boolean; status?: number | null; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ExtractionProviderError';
    this.retryable = options.retryable;
    this.status = options.status ?? null;
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

const bodySnippet = (body: string): string => body.slice(0, 300).replace(/\s+/g, ' ').trim();

export interface HttpExtractionOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly timeoutMs?: number | undefined;
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
      { retryable: isRetryableStatus(response.status), status: response.status },
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

export function createOpenAiExtractionProvider(options: HttpExtractionOptions): ExtractionProvider {
  const url = `${options.baseUrl ?? 'https://api.openai.com/v1'}/responses`;

  return {
    model: options.model,

    async extract(request: ExtractionProviderRequest) {
      const payload = await post(
        url,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: options.model,
            max_output_tokens: request.maxOutputTokens,
            input: [
              { role: 'system', content: request.system },
              { role: 'user', content: request.user },
            ],
            text: { format: { type: 'json_object' } },
          }),
        },
        options,
        'openai',
      );

      const record = asRecord(payload);
      const usage = asRecord(record?.usage);
      const text = collectOpenAiText(record);

      return {
        text,
        inputTokens: asNumber(usage?.input_tokens),
        outputTokens: asNumber(usage?.output_tokens),
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
