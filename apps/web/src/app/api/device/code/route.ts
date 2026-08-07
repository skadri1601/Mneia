import { generateDeviceCodePair } from '../../../../server/device-codes.js';
import {
  DEVICE_CODE_LIFETIME_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  deviceStore,
  verificationUri,
  verificationUriComplete,
} from '../../../../server/device-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CLIENT_LABEL = 120;

const readClientLabel = async (request: Request): Promise<string> => {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return '';

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return '';
  }

  if (typeof body !== 'object' || body === null) return '';
  const label = (body as Record<string, unknown>).client_label;
  return typeof label === 'string' ? label.slice(0, MAX_CLIENT_LABEL) : '';
};

export async function POST(request: Request): Promise<Response> {
  const clientLabel = await readClientLabel(request);
  const pair = generateDeviceCodePair();

  await deviceStore.start({
    deviceCodeHash: pair.deviceCodeHash,
    userCode: pair.userCode,
    confirmationCode: pair.confirmationCode,
    clientLabel,
    lifetimeSeconds: DEVICE_CODE_LIFETIME_SECONDS,
  });

  return Response.json(
    {
      device_code: pair.deviceCode,
      user_code: pair.userCode,
      confirmation_code: pair.confirmationCode,
      verification_uri: verificationUri(),
      verification_uri_complete: verificationUriComplete(pair.userCode),
      expires_in: DEVICE_CODE_LIFETIME_SECONDS,
      interval: DEVICE_POLL_INTERVAL_SECONDS,
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
}
