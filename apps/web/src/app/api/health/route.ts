import { checkHealth } from '../../../server/health.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  const report = await checkHealth();
  return Response.json(report, { status: report.status === 'ok' ? 200 : 503 });
}
