import * as Sentry from '@sentry/nextjs';
import { RUNTIME_ENVIRONMENT } from '@/lib/environment';
import { authorizeProbe, PROBE_HEADER } from '@/lib/probe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FLUSH_TIMEOUT_MS = 4_000;

export class SentryProbeError extends Error {
  constructor(marker: string) {
    super(
      `deliberate MNE-240 probe error from apps/site (${marker}); if you are reading this in Sentry, production error capture works`,
    );
    this.name = 'SentryProbeError';
  }
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

const notFound = (): Response => json({ error: 'not found' }, 404);

export async function POST(request: Request): Promise<Response> {
  const verdict = authorizeProbe(request.headers.get(PROBE_HEADER), process.env);

  if (verdict !== 'authorized') {
    return notFound();
  }

  const marker = new URL(request.url).searchParams.get('marker') ?? 'unmarked';
  const error = new SentryProbeError(marker);

  const dsn = Sentry.getClient()?.getOptions().dsn;
  const dsnConfigured = typeof dsn === 'string' && dsn.length > 0;

  if (!dsnConfigured) {
    return json(
      {
        dsnConfigured: false,
        delivered: false,
        environment: RUNTIME_ENVIRONMENT,
        marker,
        detail:
          'SENTRY_DSN is not set on this deployment, so Sentry.init built a no-op client: captureException returns an id and flush() resolves true while nothing is transmitted. Every error here is being discarded silently. Set SENTRY_DSN and run this again.',
      },
      503,
    );
  }

  if (new URL(request.url).searchParams.get('mode') === 'throw') {
    throw error;
  }

  const eventId = Sentry.captureException(error);
  const delivered = await Sentry.flush(FLUSH_TIMEOUT_MS);

  return json(
    {
      eventId,
      dsnConfigured: true,
      delivered,
      environment: RUNTIME_ENVIRONMENT,
      marker,
      detail: delivered
        ? 'flush() completed. This reports that the transport drained, not that Sentry accepted the event - confirm the event id appears in the project.'
        : 'flush() timed out, so the event may not have left the Worker.',
    },
    delivered ? 200 : 503,
  );
}
