import 'server-only';

import type { DeliveryResult } from './access-email.js';
import { appOrigin } from './admission-runtime.js';
import type { TeamInvitationInput } from './invitation-email.js';
import {
  INVITE_EMAIL_FROM_VAR,
  INVITE_EMAIL_KEY_VAR,
  renderTeamInvitation,
  sendTeamInvitation,
} from './invitation-email.js';

export const joinUrl = (token: string): string =>
  `${appOrigin()}/join/${encodeURIComponent(token)}`;

const configured = (variable: string): string | null => {
  const value = process.env[variable];
  return value === undefined || value.trim().length === 0 ? null : value.trim();
};

export interface DeliverInvitationInput extends TeamInvitationInput {
  readonly to: string;
  readonly invitationId: string;
}

export const deliverInvitationEmail = async (
  input: DeliverInvitationInput,
): Promise<DeliveryResult> => {
  const from = configured(INVITE_EMAIL_FROM_VAR);
  const apiKey = configured(INVITE_EMAIL_KEY_VAR);

  if (from === null || apiKey === null) {
    return {
      delivered: false,
      providerId: null,
      detail: `${from === null ? INVITE_EMAIL_FROM_VAR : INVITE_EMAIL_KEY_VAR} is not set, so no invitation email was sent`,
    };
  }

  return sendTeamInvitation({
    to: input.to,
    from,
    apiKey,
    idempotencyKey: `invitation:${input.invitationId}`,
    email: renderTeamInvitation(input),
  });
};
