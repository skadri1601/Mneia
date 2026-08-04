import 'server-only';

import type { DeliveryResult } from './access-email.js';
import { ACCESS_GRANTED_CAMPAIGN, renderAccessGranted } from './access-email.js';
import type { Invitation } from './invitations.js';
import type { AdmissionStore } from './store/admission-store.js';

export type AdmissionOutcome = 'invited' | 'invited_without_email' | 'already_emailed';

export interface AdmitSignupResult {
  readonly outcome: AdmissionOutcome;
  readonly email: string;
  readonly invitationId: string;
  readonly detail: string | null;
}

export interface AdmitSignupInput {
  readonly signupId: string;
  readonly approvedBy: string;
  readonly store: AdmissionStore;
  readonly createInvitation: (request: {
    readonly emailAddress: string;
    readonly redirectUrl: string;
  }) => Promise<Invitation>;
  readonly deliver: (input: {
    readonly to: string;
    readonly idempotencyKey: string;
    readonly subject: string;
    readonly text: string;
    readonly headers: Readonly<Record<string, string>>;
  }) => Promise<DeliveryResult>;
  readonly welcomeUrl: string;
}

export const admitSignup = async ({
  signupId,
  approvedBy,
  store,
  createInvitation,
  deliver,
  welcomeUrl,
}: AdmitSignupInput): Promise<AdmitSignupResult> => {
  const approved = await store.approve({ signupId, approvedBy });

  const invitation = await createInvitation({
    emailAddress: approved.email,
    redirectUrl: welcomeUrl,
  });

  await store.recordInvitation(approved.id, invitation.id);

  const claimId = await store.claimSend({
    signupId: approved.id,
    campaign: ACCESS_GRANTED_CAMPAIGN,
  });

  if (claimId === null) {
    return {
      outcome: 'already_emailed',
      email: approved.email,
      invitationId: invitation.id,
      detail: 'This address was already sent the access email; no second message was sent.',
    };
  }

  const rendered = renderAccessGranted({
    invitationUrl: invitation.url,
    unsubscribeToken: approved.unsubscribeToken,
  });

  const result = await deliver({
    to: approved.email,
    idempotencyKey: `${ACCESS_GRANTED_CAMPAIGN}:${approved.id}`,
    subject: rendered.subject,
    text: rendered.text,
    headers: rendered.headers,
  });

  await store.settleSend({
    claimId,
    providerId: result.providerId,
    delivered: result.delivered,
  });

  return {
    outcome: result.delivered ? 'invited' : 'invited_without_email',
    email: approved.email,
    invitationId: invitation.id,
    detail: result.detail,
  };
};
