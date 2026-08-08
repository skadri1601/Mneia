'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AccountError,
  assertMayAdministerInvitations,
  inviteTeammate,
} from '../../server/account.js';
import { accountStore, getCurrentAccount } from '../../server/current-account.js';
import { deliverInvitationEmail, joinUrl } from '../../server/invitation-runtime.js';

const textField = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
};

const INVITE_FAILURES: ReadonlySet<string> = new Set([
  'invalid_email',
  'invalid_role',
  'not_permitted',
]);

const isDuplicateInvitation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === '23505';

export async function inviteTeammateAction(formData: FormData): Promise<void> {
  let destination: string;

  try {
    const account = await getCurrentAccount();
    const { invitation, token } = await inviteTeammate({
      workspaceId: account.workspace.id,
      teamId: account.team.id,
      invitedByActorId: account.actor.id,
      invitedByMembership: account.membership,
      email: textField(formData, 'email'),
      role: textField(formData, 'role'),
      store: accountStore,
    });

    const delivery = await deliverInvitationEmail({
      to: invitation.invitedEmail,
      invitationId: invitation.id,
      workspaceName: account.workspace.displayName,
      inviterName: account.actor.displayName,
      role: invitation.role,
      joinUrl: joinUrl(token),
    });

    destination = delivery.delivered
      ? `/team?notice=invited&token=${encodeURIComponent(token)}`
      : `/team?error=invite_email_failed&token=${encodeURIComponent(token)}`;
  } catch (error) {
    if (error instanceof AccountError && INVITE_FAILURES.has(error.code)) {
      destination = `/team?error=${error.code}`;
    } else if (isDuplicateInvitation(error)) {
      destination = '/team?error=already_invited';
    } else {
      throw error;
    }
  }

  revalidatePath('/team');
  redirect(destination);
}

export async function revokeInvitationAction(formData: FormData): Promise<void> {
  let destination = '/team?notice=revoked';

  try {
    const account = await getCurrentAccount();
    assertMayAdministerInvitations(account.membership);
    await accountStore.revokeInvitation({
      workspaceId: account.workspace.id,
      invitationId: textField(formData, 'invitationId'),
    });
  } catch (error) {
    if (error instanceof AccountError && error.code === 'invitation_not_found') {
      destination = '/team?error=invitation_not_found';
    } else if (error instanceof AccountError && error.code === 'not_permitted') {
      destination = '/team?error=not_permitted';
    } else {
      throw error;
    }
  }

  revalidatePath('/team');
  redirect(destination);
}
