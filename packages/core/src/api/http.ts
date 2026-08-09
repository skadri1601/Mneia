import { z } from 'zod';

export const API_ERROR_CODES = [
  'invalid_token',
  'forbidden',
  'invalid_request',
  'not_found',
  'supersede_refused',
  'payload_too_large',
  'rate_limited',
  'unsupported',
  'internal',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const ApiErrorWireSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string(),
  }),
});

const OAuthErrorWireSchema = z.object({
  error: z.string().min(1),
  error_description: z.string().optional(),
});

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpTransportOptions {
  readonly endpoint: string;
  readonly token: string;
  readonly fetchImpl?: FetchLike | undefined;
  readonly userAgent?: string | undefined;
}

export interface HttpTransport {
  request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T>;
}

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const statusToCode = (status: number): ApiErrorCode => {
  if (status === 401) {
    return 'invalid_token';
  }
  if (status === 403) {
    return 'forbidden';
  }
  if (status === 404) {
    return 'not_found';
  }
  if (status === 409) {
    return 'supersede_refused';
  }
  if (status === 413) {
    return 'payload_too_large';
  }
  if (status === 429) {
    return 'rate_limited';
  }
  if (status === 501) {
    return 'unsupported';
  }
  return status >= 400 && status < 500 ? 'invalid_request' : 'internal';
};

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  const base = trimTrailingSlash(options.endpoint);
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));

  return {
    async request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
      const url = `${base}${path}`;
      const headers: Record<string, string> = {
        authorization: `Bearer ${options.token}`,
        accept: 'application/json',
      };
      if (options.userAgent !== undefined) {
        headers['user-agent'] = options.userAgent;
      }
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
      }

      const response = await fetchImpl(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      const text = await response.text();
      let payload: unknown = null;
      if (text.length > 0) {
        try {
          payload = JSON.parse(text);
        } catch (cause) {
          throw new ApiError(
            'internal',
            `expected ${url} to return JSON; received ${text.slice(0, 200)}`,
            response.status,
            { cause },
          );
        }
      }

      if (!response.ok) {
        const parsed = ApiErrorWireSchema.safeParse(payload);
        if (parsed.success) {
          throw new ApiError(parsed.data.error.code, parsed.data.error.message, response.status);
        }
        const oauth = OAuthErrorWireSchema.safeParse(payload);
        if (oauth.success) {
          throw new ApiError(
            statusToCode(response.status),
            oauth.data.error_description ?? oauth.data.error,
            response.status,
          );
        }
        throw new ApiError(
          statusToCode(response.status),
          `${url} responded ${response.status} with no readable error body`,
          response.status,
        );
      }

      const decoded = schema.safeParse(payload);
      if (decoded.success) {
        return decoded.data;
      }
      throw new ApiError(
        'internal',
        `${url} returned a body this client cannot read: ${decoded.error.issues
          .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
          .join('; ')} — the server may be running a newer API than this client`,
        response.status,
      );
    },
  };
}
