import { bearerTokenFrom, hashSecret } from '../../../server/device-codes.js';
import { deviceStore } from '../../../server/device-runtime.js';
import { DeviceError } from '../../../server/store/device-store.js';
import { apiError } from '../../../server/api-auth.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const unauthorized = (description: string): Response => apiError('invalid_token', description);

export async function GET(request: Request): Promise<Response> {
  const token = bearerTokenFrom(request.headers.get('authorization'));
  if (token.length === 0) {
    return unauthorized('expected an Authorization: Bearer <token> header; found none');
  }

  try {
    const identity = await deviceStore.identify(hashSecret(token));

    return Response.json(
      {
        actor: {
          id: identity.actorId,
          display_name: identity.actorName,
          kind: identity.actorKind,
        },
        workspace: {
          id: identity.workspaceId,
          slug: identity.workspaceSlug,
          display_name: identity.workspaceName,
        },
        team: { id: identity.teamId, display_name: identity.teamName },
      },
      { status: 200, headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof DeviceError && error.code === 'unknown_token') {
      return unauthorized(error.message);
    }
    throw error;
  }
}
