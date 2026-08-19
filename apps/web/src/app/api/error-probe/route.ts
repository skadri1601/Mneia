import { ErrorProbeError, inspectProbeRequest } from '../../../server/error-probe.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const notFound = (): Response =>
  Response.json({ error: { code: 'not_found', message: 'not found' } }, { status: 404 });

export async function POST(request: Request): Promise<Response> {
  const verdict = inspectProbeRequest(request.headers.get('x-mneia-error-probe'));

  if (verdict !== 'armed') {
    return notFound();
  }

  throw new ErrorProbeError(new URL(request.url).searchParams.get('label') ?? 'unlabelled');
}
