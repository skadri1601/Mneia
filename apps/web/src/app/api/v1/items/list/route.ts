import { ContextItemFilterWireSchema } from '@mneia/core';
import { handleListItems } from '../../../../../server/api/handlers.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ContextItemFilterWireSchema,
    run: (store, input) => handleListItems(store, input),
  });
