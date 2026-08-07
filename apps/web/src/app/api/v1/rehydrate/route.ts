import { RehydrateRequestWireSchema } from '@mneia/core';
import { handleRehydrate } from '../../../../server/api/handlers.js';
import { serve } from '../../../../server/api/serve.js';
import { telemetry } from '../../../../server/telemetry-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: RehydrateRequestWireSchema,
    run: (store, input) =>
      handleRehydrate(store, input, {
        telemetry: telemetry(),
        now: () => new Date(),
        monotonicMs: () => performance.now(),
      }),
  });
