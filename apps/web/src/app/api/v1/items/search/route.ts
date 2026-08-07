import { ContextItemSearchWireSchema } from '@mneia/core';
import { handleSearchItems } from '../../../../../server/api/handlers.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ContextItemSearchWireSchema,
    run: (store, input) => handleSearchItems(store, input),
  });
