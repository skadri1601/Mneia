import { CheckpointProposeWireSchema } from '@mneia/core';
import { handleProposeCheckpoint } from '../../../../../server/api/propose.js';
import { checkpointQuotaFor } from '../../../../../server/billing/runtime.js';
import { serve } from '../../../../../server/api/serve.js';
import {
  DEFAULT_SERVICE_TIER,
  SERVICE_TIERS,
  type ServiceTier,
} from '../../../../../server/extraction/providers.js';
import {
  checkpointSourceStore,
  extractionRunner,
} from '../../../../../server/extraction-runtime.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Which tier the runner will ask for, so usage is priced against the rate that served it.
 *
 * Narrowed rather than re-validated: extraction-runtime.ts refuses to build a runner at
 * all on an unknown value, so by the time a request reaches here the variable is either a
 * known tier or unset, and duplicating that check would give the same failure two owners.
 * The runner does not expose its tier, which is why this reads the environment a second
 * time — see the cross-lane note on ExtractionRunner.
 */
const configuredServiceTier = (): ServiceTier => {
  const raw = process.env.MNEIA_EXTRACTION_SERVICE_TIER?.trim();
  return SERVICE_TIERS.find((tier) => tier === raw) ?? DEFAULT_SERVICE_TIER;
};

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
        serviceTier: configuredServiceTier(),
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
