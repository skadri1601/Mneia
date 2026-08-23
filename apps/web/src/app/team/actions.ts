'use server';

import * as Sentry from '@sentry/nextjs';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  AccountError,
  assertMayAdministerInvitations,
  inviteTeammate,
} from '../../server/account.js';
import { billingRuntime } from '../../server/billing/runtime.js';
import { admitOneMoreSeat, desiredSeatQuantity } from '../../server/billing/seats.js';
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

/**
 * Lower the Stripe quantity after a member is removed.
 *
 * Three deliberate properties, in order of how much they matter:
 *
 * 1. **It runs after the removal transaction has committed, never inside it.** The transaction
 *    deletes membership rows and revokes API tokens; holding it open across a network call to
 *    Stripe would put a third party's latency on a lock over tenant rows.
 * 2. **A failure cannot undo or block the removal.** By the time this runs the member is out
 *    of the workspace and their credentials are dead. That is an access-control outcome and it
 *    must stand even when Stripe is unreachable — the failure mode of "we could not tell
 *    Stripe" is an overcharge, and the failure mode of rolling back would be a person who
 *    still has access. We take the overcharge and report it.
 * 3. **It is not swallowed.** The exception goes to Sentry with a tag naming this path, and
 *    the caller redirects with a flag so the team page tells the lead in plain words that the
 *    seat may still be billed. Silence here would be a slow revenue leak that nobody sees.
 *
 * `billingRuntime()` is constructed inside the try on purpose: it calls
 * `requireStripeConfiguration`, which throws when Stripe is not configured. A deployment
 * without Stripe keys must still be able to remove people.
 *
 * The seat count is read *after* the removal, and `desiredSeatQuantity` counts members plus
 * live invitations — so a workspace with an invitation still outstanding does not drop the
 * seat that invitation is going to need.
 *
 * `syncSeats` is the membership path, which may only ever lower the bill. `purchaseSeats` is
 * the one that may raise it and is deliberately not reachable from here.
 */
const releaseSeatAfterRemoval = async (scope: {
  readonly workspaceId: string;
  readonly actorId: string;
}): Promise<boolean> => {
  try {
    const position = await seats().seatPosition(scope);
    if (position === null) {
      throw new Error(
        `expected workspace ${scope.workspaceId} to have a readable seat position immediately after a removal; found none — the released seat was not reported to Stripe`,
      );
    }

    await billingRuntime().seatSync.syncSeats({
      workspaceId: scope.workspaceId,
      seats: desiredSeatQuantity(position),
      reason: 'member_removed',
    });
    return true;
  } catch (error) {
    Sentry.captureException(error, { tags: { mneia_seat_sync: 'member_removed' } });
    return false;
  }
};

/**
 * Remove a member, or leave the workspace yourself.
 *
 * Everything that decides the outcome — who is removing, who is being removed, both their
 * roles, and how many owners remain — is read inside the store transaction from the scope,
 * not from this form. The form contributes exactly one thing: which actor id to remove. That
 * is validated as a UUID in the store and checked for membership of *this* workspace before
 * anything is deleted, so a forged id names nobody.
 *
 * A self-removal redirects to `/projects` rather than back to `/team`: the page it came from
 * belongs to a workspace the caller is no longer in.
 */
export async function removeMemberAction(formData: FormData): Promise<void> {
  const account = await getCurrentAccount();
  const scope = scopeOf(account);
  const result = await seats().removeMember(scope, {
    actorId: textField(formData, 'actorId'),
  });

  revalidatePath('/team');
  revalidatePath('/tokens');
  revalidatePath('/projects');

  if (!result.removed) {
    redirect(`/team?error=${result.code}`);
    return;
  }

  // Only after the removal has committed. See `releaseSeatAfterRemoval`.
  const synced = await releaseSeatAfterRemoval(scope);
  const unsynced = synced ? '' : '&seat_sync=failed';

  redirect(
    result.selfRemoval
      ? `/projects?notice=left_workspace${unsynced}`
      : `/team?notice=removed${unsynced}`,
  );
}

/**
 * Change a member's workspace role.
 *
 * Like `removeMemberAction`, the form contributes only what it must — which actor, and which
 * role — and both are validated in the store before anything is written. Who is asking, what
 * rank they hold, and how many owners remain are all read from the scope inside the same
 * transaction that writes.
 *
 * `/team` is revalidated but `/tokens` is not: a role change neither issues nor revokes
 * credentials. Seats are untouched too, so nothing here consults the seat position or the
 * Stripe sync.
 */
export async function changeRoleAction(formData: FormData): Promise<void> {
  const account = await getCurrentAccount();
  const result = await seats().changeRole(scopeOf(account), {
    actorId: textField(formData, 'actorId'),
    role: textField(formData, 'role'),
  });

  revalidatePath('/team');

  if (!result.changed) {
    redirect(`/team?error=${result.code}`);
    return;
  }

  redirect(`/team?notice=role_changed&role=${encodeURIComponent(result.newRole)}`);
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
