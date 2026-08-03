import 'server-only';

export const ACCESS_GRANTED_CAMPAIGN = 'access-granted';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const siteOrigin = (raw: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): string =>
  (raw ?? 'https://mneia.dev').replace(/\/+$/, '');

export const unsubscribePostUrl = (token: string, origin = siteOrigin()): string =>
  `${origin}/api/waitlist/unsubscribe?token=${encodeURIComponent(token)}`;

export const unsubscribePageUrl = (token: string, origin = siteOrigin()): string =>
  `${origin}/unsubscribe?token=${encodeURIComponent(token)}`;

export interface AccessGrantedInput {
  readonly invitationUrl: string;
  readonly unsubscribeToken: string;
  readonly origin?: string;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly headers: Readonly<Record<string, string>>;
}

export const renderAccessGranted = ({
  invitationUrl,
  unsubscribeToken,
  origin = siteOrigin(),
}: AccessGrantedInput): RenderedEmail => {
  if (invitationUrl.trim().length === 0) {
    throw new Error('renderAccessGranted needs an invitation URL; received an empty string');
  }

  return {
    subject: 'Your Mneia access is open',
    text: [
      'You asked for early access to Mneia, and we said you would hear from us',
      'once — when access opened. This is that email.',
      '',
      'Set up your account here. The link is yours alone and expires in 30 days:',
      invitationUrl,
      '',
      'Mneia is the shared project memory and handoff layer for teams working with',
      'AI agents. Three operations, and nothing else: checkpoint what was decided,',
      'rehydrate the next session with only the context that matters, and hand work',
      'over as an artifact the next person can actually receive.',
      '',
      'If something does not work, reply to this message — it reaches a person.',
      '',
      'This is the last email you will get from the waitlist. Your address comes off',
      'the list within 30 days now that your access is open, as our privacy policy says.',
      '',
      'To remove it immediately, open this link — it deletes your address rather than',
      'suppressing it, and takes effect at once:',
      unsubscribePageUrl(unsubscribeToken, origin),
    ].join('\n'),
    headers: {
      'List-Unsubscribe': `<${unsubscribePostUrl(unsubscribeToken, origin)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
};

export interface DeliveryResult {
  readonly delivered: boolean;
  readonly providerId: string | null;
  readonly detail: string | null;
}

export interface SendAccessGrantedInput {
  readonly to: string;
  readonly from: string;
  readonly apiKey: string;
  readonly idempotencyKey: string;
  readonly email: RenderedEmail;
  readonly fetchImpl?: typeof fetch;
}

export const sendAccessGranted = async ({
  to,
  from,
  apiKey,
  idempotencyKey,
  email,
  fetchImpl = fetch,
}: SendAccessGrantedInput): Promise<DeliveryResult> => {
  let response: Response;

  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to,
        subject: email.subject,
        text: email.text,
        headers: email.headers,
      }),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return {
      delivered: false,
      providerId: null,
      detail: `the request to Resend failed in transit (${cause}) — it may still have been accepted`,
    };
  }

  if (!response.ok) {
    return {
      delivered: false,
      providerId: null,
      detail: `Resend returned ${response.status} ${response.statusText}`,
    };
  }

  const payload: unknown = await response.json().catch(() => ({}));
  const providerId =
    typeof payload === 'object' && payload !== null && 'id' in payload
      ? ((payload as { id?: unknown }).id ?? null)
      : null;

  return {
    delivered: true,
    providerId: typeof providerId === 'string' ? providerId : null,
    detail: null,
  };
};
