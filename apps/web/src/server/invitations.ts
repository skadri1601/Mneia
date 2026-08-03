import 'server-only';

import { clerkClient } from '@clerk/nextjs/server';

export type InvitationErrorCode = 'invitation_failed' | 'invitation_url_missing';

export class InvitationError extends Error {
  readonly code: InvitationErrorCode;

  constructor(code: InvitationErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InvitationError';
    this.code = code;
  }
}

export interface Invitation {
  readonly id: string;
  readonly url: string;
}

export interface CreateInvitationRequest {
  readonly emailAddress: string;
  readonly redirectUrl: string;
}

export interface InvitationApiResult {
  readonly id: string;
  readonly url?: string | undefined;
}

export type InvitationApi = (request: {
  readonly emailAddress: string;
  readonly redirectUrl: string;
  readonly notify: boolean;
  readonly ignoreExisting: boolean;
}) => Promise<InvitationApiResult>;

export const createInvitationWith = async (
  api: InvitationApi,
  { emailAddress, redirectUrl }: CreateInvitationRequest,
): Promise<Invitation> => {
  let result: InvitationApiResult;

  try {
    result = await api({ emailAddress, redirectUrl, notify: false, ignoreExisting: true });
  } catch (error) {
    throw new InvitationError(
      'invitation_failed',
      `Clerk refused to create an invitation for ${emailAddress}`,
      { cause: error },
    );
  }

  if (typeof result.url !== 'string' || result.url.length === 0) {
    throw new InvitationError(
      'invitation_url_missing',
      `Clerk created invitation ${result.id} but returned no acceptance URL, so there is no link to email. Send it from the Clerk dashboard, or re-run once Clerk returns a url.`,
    );
  }

  return { id: result.id, url: result.url };
};

export const createInvitation = (request: CreateInvitationRequest): Promise<Invitation> =>
  createInvitationWith(async (input) => {
    const client = await clerkClient();
    const invitation = await client.invitations.createInvitation({
      emailAddress: input.emailAddress,
      redirectUrl: input.redirectUrl,
      notify: input.notify,
      ignoreExisting: input.ignoreExisting,
    });
    return { id: invitation.id, url: invitation.url };
  }, request);
