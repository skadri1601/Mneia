import { ApiRequestError } from '../../../../server/api/handlers.js';
import { serve } from '../../../../server/api/serve.js';
import { clientVisibleUsage } from '../../../../server/billing/usage.js';
import { loadUsageReport } from '../../../../server/billing/usage-store.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = (request: Request): Promise<Response> =>
  serve({
    request,
    cost: 'read',
    input: null,
    run: async (store) => {
      const report = await loadUsageReport(store.scope.workspaceId);
      if (report === null) {
        // Deliberately not not_found. A 404 here is indistinguishable from "this deployment
        // is too old to have /api/v1/usage", which a client must treat as benign, so the
        // actionable message would be swallowed at the one moment it is needed. The token
        // authenticated, so this is not invalid_token either — re-issuing it is the remedy,
        // but discarding a good credential over a torn workspace row is not.
        throw new ApiRequestError(
          'forbidden',
          'the workspace this token is scoped to has no row to meter, so its usage cannot be reported; sign in again to re-issue the token, and report this if it persists — an authenticated workspace should always have one',
        );
      }
      return clientVisibleUsage(report);
    },
  });
