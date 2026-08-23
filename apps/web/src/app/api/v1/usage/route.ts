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
        throw new ApiRequestError(
          'not_found',
          'this token is scoped to a workspace that no longer has a row to meter; sign in again to re-issue it',
        );
      }
      return clientVisibleUsage(report);
    },
  });
