import { ListProjectSessionsWireSchema } from '@mneia/core';
import { handleListProjectSessions } from '../../../../../server/api/handlers.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ListProjectSessionsWireSchema,
    run: (store, input) => handleListProjectSessions(store, input),
  });
