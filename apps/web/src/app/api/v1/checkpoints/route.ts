import { CheckpointWriteWireSchema } from '@mneia/core';
import { handleWriteCheckpoint } from '../../../../server/api/handlers.js';
import { serve } from '../../../../server/api/serve.js';
import { embeddingProvider } from '../../../../server/embedding-runtime.js';
import { telemetry } from '../../../../server/telemetry-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    schema: CheckpointWriteWireSchema,
    run: (store, input) =>
      handleWriteCheckpoint(store, input, {
        telemetry: telemetry(),
        embeddings: embeddingProvider(),
        now: () => new Date(),
      }),
  });
