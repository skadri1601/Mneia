import { generateApiToken, hashSecret } from '../../../../server/device-codes.js';
import { DEVICE_POLL_INTERVAL_SECONDS, deviceStore } from '../../../../server/device-runtime.js';
import { DeviceError, type DeviceErrorCode } from '../../../../server/store/device-store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const OAUTH_ERRORS: Readonly<Record<DeviceErrorCode, { error: string; status: number }>> = {
  authorization_pending: { error: 'authorization_pending', status: 400 },
  authorization_denied: { error: 'access_denied', status: 400 },
  authorization_expired: { error: 'expired_token', status: 400 },
  already_redeemed: { error: 'invalid_grant', status: 400 },
  unknown_device_code: { error: 'invalid_grant', status: 400 },
  unknown_user_code: { error: 'invalid_grant', status: 400 },
  already_decided: { error: 'invalid_grant', status: 400 },
  confirmation_mismatch: { error: 'invalid_grant', status: 400 },
  too_many_attempts: { error: 'slow_down', status: 400 },
  unknown_token: { error: 'invalid_grant', status: 400 },
  rollback_failed: { error: 'server_error', status: 500 },
  session_cleanup_failed: { error: 'server_error', status: 500 },
  corrupt_device_state: { error: 'server_error', status: 500 },
};

const readDeviceCode = async (request: Request): Promise<string> => {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const form = new URLSearchParams(await request.text());
    return form.get('device_code') ?? '';
  }

  if (contentType.includes('application/json')) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return '';
    }
    if (typeof body !== 'object' || body === null) return '';
    const code = (body as Record<string, unknown>).device_code;
    return typeof code === 'string' ? code : '';
  }

  return '';
};

const failure = (code: DeviceErrorCode, description: string): Response => {
  const mapped = OAUTH_ERRORS[code];
  return Response.json(
    { error: mapped.error, error_description: description },
    { status: mapped.status, headers: { 'cache-control': 'no-store' } },
  );
};

export async function POST(request: Request): Promise<Response> {
  const deviceCode = await readDeviceCode(request);
  if (deviceCode.length === 0) {
    return Response.json(
      {
        error: 'invalid_request',
        error_description: 'expected a device_code in the request body; found none',
      },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    );
  }

  const token = generateApiToken();

  try {
    const redeemed = await deviceStore.redeem({
      deviceCodeHash: hashSecret(deviceCode),
      tokenHash: token.tokenHash,
      label: 'mneia login',
    });

    return Response.json(
      {
        access_token: token.token,
        token_type: 'Bearer',
        workspace_id: redeemed.workspaceId,
        actor_id: redeemed.actorId,
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof DeviceError) {
      if (error.code === 'authorization_pending') {
        return Response.json(
          {
            error: 'authorization_pending',
            error_description: error.message,
            interval: DEVICE_POLL_INTERVAL_SECONDS,
          },
          { status: 400, headers: { 'cache-control': 'no-store' } },
        );
      }
      return failure(error.code, error.message);
    }
    throw error;
  }
}
