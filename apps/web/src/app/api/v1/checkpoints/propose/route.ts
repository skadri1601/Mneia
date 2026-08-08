import { CheckpointProposeWireSchema } from '@mneia/core';
import { handleProposeCheckpoint } from '../../../../../server/api/propose.js';
import { serve } from '../../../../../server/api/serve.js';
import {
  checkpointSourceStore,
  extractionRunner,
} from '../../../../../server/extraction-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const POST = (request: Request): Promise<Response> =>
  serve({
    request,
    cost: 'checkpoint',
    schema: CheckpointProposeWireSchema,
    run: (store, input) => {
      const sourceStore = checkpointSourceStore();
      return handleProposeCheckpoint(store, input, {
        run: (prompt) => extractionRunner().run(prompt),
        watermarkFor: (query) =>
          sourceStore.watermarkFor({ ...query, workspaceId: store.scope.workspaceId }),
        recordUsage: (usage) =>
          sourceStore.recordUsage({
            ...usage,
            workspaceId: store.scope.workspaceId,
            checkpointId: null,
          }),
      });
    },
  });
