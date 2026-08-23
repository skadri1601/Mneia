import { handleGetHandoff } from '../../../../../server/api/handoff.js';
import { serve } from '../../../../../server/api/serve.js';
import { parseHandoffId } from './handoff-id.js';

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
    run: (store, handoffId) => handleGetHandoff(store, parseHandoffId(handoffId)),
  });
};
