import { StaleContextItemFilterWireSchema } from '@mneia/core';
import { handleListStaleItems } from '../../../../../server/api/handlers.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: StaleContextItemFilterWireSchema,
    run: (store, input) => handleListStaleItems(store, input),
  });
