import { ReceiveHandoffWireSchema } from '@mneia/core';
import { handleReceiveHandoff } from '../../../../../server/api/handoff.js';
import { serve } from '../../../../../server/api/serve.js';
import { telemetry } from '../../../../../server/telemetry-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: ReceiveHandoffWireSchema,
    run: (store, input) =>
      handleReceiveHandoff(store, input, { telemetry: telemetry(), now: () => new Date() }),
  });
