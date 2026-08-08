import 'server-only';

import type { DeliveryResult, RenderedEmail } from './access-email.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export const INVITE_EMAIL_FROM_VAR = 'MNEIA_INVITE_FROM';
export const INVITE_EMAIL_KEY_VAR = 'RESEND_API_KEY';

export interface TeamInvitationInput {
  readonly workspaceName: string;
  readonly inviterName: string;
  readonly role: string;
  readonly joinUrl: string;
}

export const renderTeamInvitation = ({
  workspaceName,
  inviterName,
  role,
  joinUrl,
}: TeamInvitationInput): RenderedEmail => {
  if (joinUrl.trim().length === 0) {
    throw new Error('renderTeamInvitation needs a join URL; received an empty string');
  }
  if (workspaceName.trim().length === 0) {
    throw new Error('renderTeamInvitation needs a workspace name; received an empty string');
  }

  return {
    subject: `${inviterName} invited you to ${workspaceName} on Mneia`,
    text: [
      `${inviterName} added you to the ${workspaceName} workspace on Mneia, as ${role}.`,
      '',
      'Accept here. The link is single-use and belongs to this address alone:',
      joinUrl,
      '',
      'Mneia is the shared project memory and handoff layer for the team you have just',
      'joined. It records what was decided and why, hands the next session only the',
      'context that matters, and makes work receivable when it changes hands.',
      '',
      'You will land in the same workspace as the person who invited you, not a new one,',
      'so their project history is there from your first session.',
      '',
      'If you were not expecting this, ignore it — the invitation expires on its own and',
      `nothing is created until you open the link. If it looks wrong, reply and tell ${inviterName}.`,
    ].join('\n'),
    headers: {},
  };
};

export interface SendTeamInvitationInput {
  readonly to: string;
  readonly from: string;
  readonly apiKey: string;
  readonly idempotencyKey: string;
  readonly email: RenderedEmail;
  readonly fetchImpl?: typeof fetch;
}

export const sendTeamInvitation = async ({
  to,
  from,
  apiKey,
  idempotencyKey,
  email,
  fetchImpl = fetch,
}: SendTeamInvitationInput): Promise<DeliveryResult> => {
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
