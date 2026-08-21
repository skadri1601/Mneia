import { ListInboxHandoffsWireSchema } from '@mneia/core';
import { handleListInboxHandoffs } from '../../../../../server/api/handoff.js';
import { serve } from '../../../../../server/api/serve.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ListInboxHandoffsWireSchema,
    run: (store, input) => handleListInboxHandoffs(store, input),
  });
