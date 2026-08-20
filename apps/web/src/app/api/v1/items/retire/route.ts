import { RetireContextItemWireSchema } from '@mneia/core';
import { handleRetireItem } from '../../../../../server/api/handlers.js';
import { serve } from '../../../../../server/api/serve.js';
import { telemetry } from '../../../../../server/telemetry-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: RetireContextItemWireSchema,
    run: (store, input) =>
      handleRetireItem(store, input, {
        telemetry: telemetry(),
        now: () => new Date(),
      }),
  });
