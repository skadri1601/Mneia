import type { ApiErrorCode } from '@mneia/core';
import { bearerTokenFrom, hashSecret, headerSafe } from './device-codes.js';
import { type BearerIdentity, DeviceError } from './store/device-store.js';

const STATUS_BY_CODE: Readonly<Record<ApiErrorCode, number>> = {
  invalid_token: 401,
  invalid_request: 400,
  not_found: 404,
  supersede_refused: 409,
  unsupported: 501,
  internal: 500,
};

export const apiError = (code: ApiErrorCode, message: string): Response =>
  Response.json(
    { error: { code, message } },
    {
      status: STATUS_BY_CODE[code],
      headers: {
        'cache-control': 'no-store',
        ...(code === 'invalid_token'
          ? {
              'www-authenticate': `Bearer error="invalid_token", error_description="${headerSafe(message)}"`,
            }
          : {}),
      },
    },
  );

export const apiOk = (body: unknown): Response =>
  Response.json(body, { status: 200, headers: { 'cache-control': 'no-store' } });

export class ApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiAuthError';
  }
}

export interface IdentifyBearer {
  (tokenHash: string): Promise<BearerIdentity>;
}

export const resolveBearerIdentity = async (
  authorization: string | null,
  identify: IdentifyBearer,
): Promise<BearerIdentity> => {
  const token = bearerTokenFrom(authorization);
  if (token.length === 0) {
    throw new ApiAuthError('expected an Authorization: Bearer <token> header; found none');
  }

  try {
    return await identify(hashSecret(token));
  } catch (error) {
    if (error instanceof DeviceError && error.code === 'unknown_token') {
      throw new ApiAuthError(error.message);
    }
    throw error;
  }
};
