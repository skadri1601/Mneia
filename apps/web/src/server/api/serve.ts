import 'server-only';

import { Buffer } from 'node:buffer';
import type { ReviewCapableStore, Uuid } from '@mneia/core';
import { StoreError, SupersedeNotAllowedError } from '@mneia/core';
import type { z } from 'zod';
import { ApiAuthError, apiError, apiOk, resolveBearerIdentity } from '../api-auth.js';
import { deviceStore } from '../device-runtime.js';
import { reportRouteFailure } from '../error-reporting.js';
import {
  evaluateRateLimit,
  RATE_LIMIT_RETENTION_SECONDS,
  type RateLimitConfig,
  type RequestCost,
  windowsFor,
} from '../rate-limit.js';
import { rateLimitConfig, rateLimitStore } from '../rate-limit-runtime.js';
import type { RateLimitStore } from '../store/rate-limit-store.js';
import { withWorkspaceScope } from '../store-runtime.js';
import { ApiRequestError } from './handlers.js';

export interface RateLimitDependencies {
  readonly store: RateLimitStore;
  readonly config: RateLimitConfig;
  readonly now: () => Date;
}

type ServeRun<TInput> = (store: ReviewCapableStore, input: TInput) => Promise<unknown>;

interface ServeCommon {
  readonly request: Request;
  readonly cost?: RequestCost | undefined;
  readonly limits?: RateLimitDependencies | undefined;
}

interface SchemaServeOptions<TInput> extends ServeCommon {
  readonly schema: z.ZodType<TInput>;
  readonly input?: undefined;
  readonly run: ServeRun<TInput>;
}

interface ValueServeOptions<TInput> extends ServeCommon {
  readonly schema?: undefined;
  readonly input: TInput;
  readonly run: ServeRun<TInput>;
}

// Two mutually exclusive ways in, so `input` can no longer be omitted and then read back as TInput.
// A caller supplies a body schema or a value, never neither and never both.
export type ServeOptions<TInput> = SchemaServeOptions<TInput> | ValueServeOptions<TInput>;

const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Every dynamic route segment goes through here rather than reaching a store method that happens
// to call assertUuid. Uuid is a bare alias for string, so this cannot be enforced by the type
// system; the enumeration guard in app/api/v1/dynamic-routes.test.ts is what keeps a new [id]
// route from skipping it.
export const parseResourceId = (value: string, what: string): Uuid => {
  if (!RESOURCE_ID.test(value)) {
    throw new ApiRequestError(
      'invalid_request',
      `expected the ${what} in the path to be a UUID; received ${JSON.stringify(value)} — pass the id exactly as the API returned it`,
    );
  }
  return value;
};

const describeIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

const tooLarge = (bytes: number, maxBytes: number): ApiRequestError =>
  new ApiRequestError(
    'payload_too_large',
    `the request body is ${bytes} bytes and the limit is ${maxBytes} — checkpoint fewer items per call, or trim the trajectory before sending it. An unbounded transcript is an unbounded prompt, so this cap is deliberate.`,
  );

const readJsonBody = async (request: Request, maxBytes: number): Promise<unknown> => {
  const text = await request.text();
  if (text.length === 0) {
    return {};
  }

  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) {
    throw tooLarge(bytes, maxBytes);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiRequestError('invalid_request', 'the request body is not valid JSON');
  }
};

const declaredLength = (request: Request): number | null => {
  const header = request.headers.get('content-length');
  if (header === null) {
    return null;
  }
  const parsed = Number(header);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const serve = async <TInput>(options: ServeOptions<TInput>): Promise<Response> => {
  try {
    const limits: RateLimitDependencies = options.limits ?? {
      store: rateLimitStore(),
      config: rateLimitConfig(),
      now: () => new Date(),
    };

    const declared = declaredLength(options.request);
    if (declared !== null && declared > limits.config.maxRequestBytes) {
      return apiError(
        'payload_too_large',
        tooLarge(declared, limits.config.maxRequestBytes).message,
      );
    }

    const identity = await resolveBearerIdentity(
      options.request.headers.get('authorization'),
      (tokenHash) => deviceStore.identify(tokenHash),
    );

    const now = limits.now();
    const windows = windowsFor({
      cost: options.cost ?? 'read',
      tokenId: identity.tokenId,
      now,
      config: limits.config,
    });
    const counters = {
      workspaceId: identity.workspaceId,
      windows,
      discardBefore: new Date(now.getTime() - RATE_LIMIT_RETENTION_SECONDS * 1000),
    };
    const counts = await limits.store.bump(counters);
    const decision = evaluateRateLimit({ windows, counts, now });
    if (!decision.allowed) {
      // Give the slot back. The counter counts requests we served, and counting a refusal
      // pushed the next caller further over the limit for the rest of the window.
      await limits.store.release(counters);
      return apiError('rate_limited', decision.message, {
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }

    let input: TInput;
    if (options.schema === undefined) {
      input = options.input;
    } else {
      const parsed = options.schema.safeParse(
        await readJsonBody(options.request, limits.config.maxRequestBytes),
      );
      if (!parsed.success) {
        return apiError('invalid_request', describeIssues(parsed.error));
      }
      input = parsed.data;
    }

    const body = await withWorkspaceScope(
      { workspaceId: identity.workspaceId, actorId: identity.actorId },
      (store) => options.run(store, input),
    );

    return apiOk(body);
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return apiError('invalid_token', error.message);
    }
    if (error instanceof ApiRequestError) {
      return apiError(error.code, error.message);
    }
    if (error instanceof SupersedeNotAllowedError) {
      return apiError('supersede_refused', error.message);
    }
    if (error instanceof StoreError) {
      if (error.code === 'not_found') {
        return apiError('not_found', error.message);
      }
      if (error.code === 'invalid_argument') {
        return apiError('invalid_request', error.message);
      }
    }

    reportRouteFailure(options.request, error);
    throw error;
  }
};
