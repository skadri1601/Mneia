import { CheckpointProposeWireSchema } from '@mneia/core';
import { handleProposeCheckpoint } from '../../../../../server/api/propose.js';
import { checkpointQuotaFor } from '../../../../../server/billing/runtime.js';
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
    schema: CheckpointProposeWireSchema,
    run: (store, input) => {
      const sourceStore = checkpointSourceStore();
      const runner = extractionRunner();
      return handleProposeCheckpoint(store, input, {
        quota: (request) => checkpointQuotaFor(store.scope.workspaceId, new Date(), request),
        run: (prompt) => runner.run(prompt),
        servableContextTokens: runner.servableContextTokens,
        primaryModel: runner.primary,
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
