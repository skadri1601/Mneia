import { CreateHandoffWireSchema } from '@mneia/core';
import { handleCreateHandoff } from '../../../../server/api/handoff.js';
import { serve } from '../../../../server/api/serve.js';
import { telemetry } from '../../../../server/telemetry-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: CreateHandoffWireSchema,
    run: (store, input) =>
      handleCreateHandoff(store, input, { telemetry: telemetry(), now: () => new Date() }),
  });
