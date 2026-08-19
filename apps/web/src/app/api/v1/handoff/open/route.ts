import { ListOpenHandoffsWireSchema } from '@mneia/core';
import { handleListOpenHandoffs } from '../../../../../server/api/handoff.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ListOpenHandoffsWireSchema,
    run: (store, input) => handleListOpenHandoffs(store, input),
  });
