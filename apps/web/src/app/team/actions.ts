'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AccountError,
  assertMayAdministerInvitations,
  inviteTeammate,
} from '../../server/account.js';
import { admitOneMoreSeat } from '../../server/billing/seats.js';
import { accountStore, getCurrentAccount } from '../../server/current-account.js';
import { deliverInvitationEmail, joinUrl } from '../../server/invitation-runtime.js';
import { seats } from '../../server/membership-runtime.js';
import type { AccountContext } from '../../server/store/account-store.js';

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

/**
 * The workspace scope for a signed-in account.
 *
 * Built from the resolved `AccountContext`, never from the submitted form, so a caller
 * cannot name someone else's workspace or borrow another actor's identity.
 */
const scopeOf = (account: AccountContext) => ({
  workspaceId: account.workspace.id,
  actorId: account.actor.id,
});

export async function inviteTeammateAction(formData: FormData): Promise<void> {
  let destination: string;

  try {
    const account = await getCurrentAccount();

    // Refuse before the invitation exists, not after it is accepted. `quota.ts` refuses
    // `seats_exceeded` for the whole workspace once members exceed purchased seats, so an
    // invitation issued past the seat count is a delayed outage for everybody already
    // working here — see `admitOneMoreSeat`.
    assertMayAdministerInvitations(account.membership);
    const position = await seats().seatPosition(scopeOf(account));
    if (position !== null && !admitOneMoreSeat(position).admitted) {
      revalidatePath('/team');
      redirect('/team?error=seats_exceeded');
      return;
    }

    const { invitation, token } = await inviteTeammate({
      workspaceId: account.workspace.id,
      teamId: account.team.id,
      invitedByActorId: account.actor.id,
      invitedByMembership: account.membership,
      email: textField(formData, 'email'),
      role: textField(formData, 'role'),
      store: accountStore,
    });

    // Written after the invitation so the record names a real row. It is a separate
    // transaction from the insert, so a crash between the two loses the audit row; folding
    // it into `PostgresAccountStore.inviteToWorkspace` is the durable fix and belongs with
    // that file.
    await seats().recordMembershipAudit(scopeOf(account), {
      action: 'membership.invitation_created',
      targetKind: 'workspace_invitation',
      targetId: invitation.id,
      metadata: {
        role: invitation.role,
        seatsPurchased: position?.seatsPurchased ?? null,
        memberCount: position?.memberCount ?? null,
        pendingInvitations: position?.pendingInvitations ?? null,
      },
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
    const invitationId = textField(formData, 'invitationId');
    await accountStore.revokeInvitation({
      workspaceId: account.workspace.id,
      invitationId,
    });
    await seats().recordMembershipAudit(scopeOf(account), {
      action: 'membership.invitation_revoked',
      targetKind: 'workspace_invitation',
      targetId: invitationId,
      metadata: {},
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
