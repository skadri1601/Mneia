import { handleGetActor } from '../../../../../server/api/handlers.js';
import { parseResourceId, serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = async (
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> => {
  const { id } = await context.params;
  return serve({
    request,
    input: id,
    run: (store, actorId) => handleGetActor(store, parseResourceId(actorId, 'actor id')),
  });
};
