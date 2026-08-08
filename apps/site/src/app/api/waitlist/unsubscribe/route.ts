import * as Sentry from '@sentry/nextjs';
import { forgetSignup, unsubscribePageUrl, WaitlistError } from '@/lib/waitlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get('token');

  if (token === null) {
    return json({ ok: false, error: 'that link is missing its unsubscribe token' }, 400);
  }

  try {
    await forgetSignup(token);
  } catch (error) {
    if (error instanceof WaitlistError) Sentry.captureException(error);
    return json({ ok: false, error: 'we could not do that just now — try again shortly' }, 503);
  }

  return json({ ok: true }, 200);
}

export function GET(request: Request): Response {
  const token = new URL(request.url).searchParams.get('token') ?? '';

  return Response.redirect(unsubscribePageUrl(token), 303);
}
