import * as Sentry from '@sentry/nextjs';
import {
  WaitlistError,
  markNotified,
  normaliseEmail,
  sendConfirmation,
  storeSignup,
} from '@/lib/waitlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2048;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? 0);

  if (declared > MAX_BODY_BYTES) {
    return json({ ok: false, error: 'that request was too large' }, 413);
  }

  let email: string;

  try {
    const payload: unknown = await request.json();
    const candidate =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>).email
        : undefined;
    email = normaliseEmail(candidate);
  } catch (error) {
    const message =
      error instanceof WaitlistError ? error.message : 'we could not read that request';
    return json({ ok: false, error: message }, 400);
  }

  let outcome: Awaited<ReturnType<typeof storeSignup>>;

  try {
    outcome = await storeSignup(email, 'site');
  } catch (error) {
    Sentry.captureException(error);
    return json({ ok: false, error: 'we could not save that just now — try again shortly' }, 503);
  }

  if (outcome === 'stored') {
    try {
      if (await sendConfirmation(email)) {
        await markNotified(email);
      }
    } catch (error) {
      Sentry.captureException(error);
    }
  }

  return json({ ok: true }, 200);
}
