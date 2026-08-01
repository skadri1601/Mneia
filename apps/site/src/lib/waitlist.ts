import { neon } from '@neondatabase/serverless';

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EMAIL_LENGTH = 254;
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

const siteOrigin = (): string =>
  (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mneia.dev').replace(/\/+$/, '');

export const unsubscribePostUrl = (token: string): string =>
  `${siteOrigin()}/api/waitlist/unsubscribe?token=${encodeURIComponent(token)}`;

export const unsubscribePageUrl = (token: string): string =>
  `${siteOrigin()}/unsubscribe?token=${encodeURIComponent(token)}`;

export type SignupResult =
  | { outcome: 'stored'; unsubscribeToken: string }
  | { outcome: 'already_present' };

export class WaitlistError extends Error {
  constructor(
    readonly reason: 'invalid_email' | 'not_configured',
    message: string,
  ) {
    super(message);
    this.name = 'WaitlistError';
  }
}

export function normaliseEmail(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new WaitlistError('invalid_email', 'expected an email address; received none');
  }

  const email = raw.trim();

  if (email.length === 0 || email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    throw new WaitlistError('invalid_email', 'that does not look like an email address');
  }

  return email;
}

export async function storeSignup(email: string, source: string): Promise<SignupResult> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new WaitlistError(
      'not_configured',
      'expected DATABASE_URL to hold the Neon connection string; found none',
    );
  }

  const sql = neon(connectionString);
  const rows = await sql`
    INSERT INTO waitlist_signup (email, source)
    VALUES (${email}, ${source})
    ON CONFLICT (lower(email)) DO NOTHING
    RETURNING unsubscribe_token
  `;

  const token = rows[0]?.unsubscribe_token;

  if (typeof token !== 'string') return { outcome: 'already_present' };

  return { outcome: 'stored', unsubscribeToken: token };
}

export async function forgetSignup(token: string): Promise<boolean> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new WaitlistError(
      'not_configured',
      'expected DATABASE_URL to hold the Neon connection string; found none',
    );
  }

  if (!UUID.test(token)) return false;

  const sql = neon(connectionString);
  const rows = await sql`
    DELETE FROM waitlist_signup
     WHERE unsubscribe_token = ${token}
    RETURNING id
  `;

  return rows.length > 0;
}

export async function sendConfirmation(email: string, unsubscribeToken: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;

  if (!key) return false;

  const oneClick = unsubscribePostUrl(unsubscribeToken);
  const optOut = unsubscribePageUrl(unsubscribeToken);

  const response = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.WAITLIST_FROM ?? 'Mneia <hello@mneia.dev>',
      to: [email],
      subject: 'You are on the Mneia list',
      headers: {
        'List-Unsubscribe': `<${oneClick}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      text: [
        'Thanks for asking for early access to Mneia.',
        '',
        'We are onboarding teams in stages. You will get one more email from us,',
        'when your access is ready — nothing else, and we do not share your address.',
        '',
        'Mneia is the shared project memory and handoff layer for teams working with',
        'AI agents. If you want to know what that means before you hear from us again:',
        'https://mneia.dev',
        '',
        'If you did not request this, ignore it and you will hear nothing further.',
        '',
        'To come off the list, open this link — it deletes your address rather than',
        'suppressing it, and takes effect immediately:',
        optOut,
      ].join('\n'),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend returned ${response.status} ${response.statusText}`);
  }

  return true;
}

export async function markNotified(email: string): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) return;

  const sql = neon(connectionString);
  await sql`
    UPDATE waitlist_signup
       SET notified_at = now()
     WHERE lower(email) = lower(${email})
       AND notified_at IS NULL
  `;
}
