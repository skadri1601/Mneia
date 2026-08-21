import { ListWorkspaceActorsWireSchema } from '@mneia/core';
import { handleListWorkspaceActors } from '../../../../../server/api/handlers.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ListWorkspaceActorsWireSchema,
    run: (store, input) => handleListWorkspaceActors(store, input),
  });
