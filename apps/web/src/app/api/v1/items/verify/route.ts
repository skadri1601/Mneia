import { VerifyContextItemWireSchema } from '@mneia/core';
import { handleVerifyItem } from '../../../../../server/api/handlers.js';
import { serve } from '../../../../../server/api/serve.js';
import { telemetry } from '../../../../../server/telemetry-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: VerifyContextItemWireSchema,
    run: (store, input) =>
      handleVerifyItem(store, input, {
        telemetry: telemetry(),
        now: () => new Date(),
      }),
  });
