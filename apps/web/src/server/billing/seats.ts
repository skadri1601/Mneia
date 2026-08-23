import 'server-only';

import type { ActorKind, BillingStatus, TeamRole, WorkspacePlan, WorkspaceRole } from '@mneia/core';
import { isSeatedPlan } from './limits.js';
import { BillingError, SEAT_PRICE_USD_CENTS } from './stripe.js';

export const MIN_SEATS = 1;

export interface SeatRequirement {
  readonly members: number;
  readonly seats: number;
}

export const seatsRequiredFor = (members: number): SeatRequirement => {
  if (!Number.isInteger(members) || members < 0) {
    throw new BillingError(
      'invalid_payload',
      `expected the member count to be a non-negative integer; received ${String(members)}`,
    );
  }
  return { members, seats: Math.max(members, MIN_SEATS) };
};

export interface SeatChange {
  readonly from: number;
  readonly to: number;
  readonly direction: 'increase' | 'decrease' | 'unchanged';
  readonly prorated: boolean;
}

export const planSeatChange = (current: number, required: number): SeatChange => {
  if (!Number.isInteger(required) || required < MIN_SEATS) {
    throw new BillingError(
      'invalid_payload',
      `expected the required seat count to be an integer of at least ${MIN_SEATS}; received ${String(required)}`,
    );
  }

  if (required === current) {
    return { from: current, to: current, direction: 'unchanged', prorated: false };
  }

  return {
    from: current,
    to: required,
    direction: required > current ? 'increase' : 'decrease',
    prorated: true,
  };
};

export interface BillingState {
  readonly plan: WorkspacePlan;
  readonly billingStatus: BillingStatus;
  readonly seatsPurchased: number | null;
  readonly billingCustomerRef: string | null;
}

export const STRIPE_STATUS_TO_BILLING: Readonly<Record<string, BillingStatus>> = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  unpaid: 'past_due',
  incomplete: 'past_due',
  incomplete_expired: 'canceled',
  canceled: 'canceled',
  paused: 'canceled',
};

export const billingStatusFor = (stripeStatus: string): BillingStatus => {
  const mapped = STRIPE_STATUS_TO_BILLING[stripeStatus];
  if (mapped === undefined) {
    throw new BillingError(
      'invalid_payload',
      `expected a known Stripe subscription status; received "${stripeStatus}". ` +
        `Known: ${Object.keys(STRIPE_STATUS_TO_BILLING).join(', ')}. An unmapped status is refused rather than guessed, ` +
        'because guessing it wrong either bills a cancelled workspace or gives a lapsed one free capacity.',
    );
  }
  return mapped;
};

export const hasTeamEntitlement = (state: BillingState): boolean =>
  state.plan === 'team' &&
  state.seatsPurchased !== null &&
  (state.billingStatus === 'active' ||
    state.billingStatus === 'trialing' ||
    state.billingStatus === 'past_due');

const stripeStatusHasTeamEntitlement = (status: string): boolean =>
  status === 'active' || status === 'trialing' || status === 'past_due';

export interface UpgradeRequest {
  readonly current: BillingState;
  readonly subscriptionStatus: string;
  readonly seats: number;
  readonly customerRef: string;
}

const NOT_GOVERNED_BY_TEAM_SUBSCRIPTION: readonly WorkspacePlan[] = ['pro', 'enterprise'];

const planAfterSubscription = (current: WorkspacePlan, teamEntitled: boolean): WorkspacePlan => {
  if (teamEntitled) {
    return current === 'enterprise' ? 'enterprise' : 'team';
  }
  return NOT_GOVERNED_BY_TEAM_SUBSCRIPTION.includes(current) ? current : 'solo';
};

export const stateAfterSubscription = (request: UpgradeRequest): BillingState => {
  const status = billingStatusFor(request.subscriptionStatus);
  const teamEntitled = stripeStatusHasTeamEntitlement(request.subscriptionStatus);

  return {
    plan: planAfterSubscription(request.current.plan, teamEntitled),
    billingStatus: status,
    seatsPurchased: teamEntitled ? request.seats : null,
    billingCustomerRef: request.customerRef,
  };
};

/**
 * What a workspace's seat position is at the moment someone is about to be added.
 *
 * `pendingInvitations` counts only *live* invitations — issued, not accepted, not revoked,
 * not expired. They are counted against seats because each one is a promise of a seat
 * already made to a named person. Leaving them out of the arithmetic lets a lead issue ten
 * invitations against one spare seat and discover the overrun when the second is accepted,
 * which is precisely the failure this admission check exists to prevent.
 */
export interface SeatPosition {
  readonly plan: WorkspacePlan;
  readonly billingStatus: BillingStatus;
  readonly seatsPurchased: number | null;
  readonly memberCount: number;
  readonly pendingInvitations: number;
}

/** Seats already spoken for: accepted members plus invitations still capable of being accepted. */
export const seatsCommitted = (position: SeatPosition): number =>
  position.memberCount + position.pendingInvitations;

/** The quantity a seat-priced subscription should carry for this position. */
export const desiredSeatQuantity = (position: SeatPosition): number =>
  Math.max(seatsCommitted(position), MIN_SEATS);

export type SeatAdmission =
  | { readonly admitted: true; readonly seatsSpare: number | null }
  | {
      readonly admitted: false;
      readonly code: 'seats_exceeded';
      readonly seatsPurchased: number;
      readonly seatsNeeded: number;
      readonly additionalSeats: number;
      readonly additionalMonthlyUsdCents: number;
      readonly message: string;
    };

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const countOf = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Whether one more person may be admitted to this workspace, and what it costs if not.
 *
 * This is the counterpart of the `seats_exceeded` refusal in `quota.ts`. That refusal is
 * workspace-wide: once accepted members exceed purchased seats, **every** member is refused
 * a checkpoint, not just the newest one. Discovering that at checkpoint time means one
 * accepted invitation silently disabled the whole team. So the decision is taken here, at
 * the moment the seat is committed, where it can still be declined and where the person
 * taking it is the lead who can pay for it.
 *
 * Only Team is seat-priced (`isSeatedPlan`). Solo and Pro are deliberately admitted without
 * limit: `checkout.ts` requires at least two accepted members before Team checkout can even
 * start, so gating growth on a free workspace would close the on-ramp to the paid plan.
 */
export const admitOneMoreSeat = (position: SeatPosition): SeatAdmission => {
  if (!isSeatedPlan(position.plan)) {
    return { admitted: true, seatsSpare: null };
  }

  const seatsPurchased = Math.max(position.seatsPurchased ?? 0, 0);
  const committed = seatsCommitted(position);
  const seatsNeeded = committed + 1;

  if (seatsNeeded <= seatsPurchased) {
    return { admitted: true, seatsSpare: seatsPurchased - seatsNeeded };
  }

  const additionalSeats = seatsNeeded - seatsPurchased;
  const additionalMonthlyUsdCents = additionalSeats * SEAT_PRICE_USD_CENTS;

  return {
    admitted: false,
    code: 'seats_exceeded',
    seatsPurchased,
    seatsNeeded,
    additionalSeats,
    additionalMonthlyUsdCents,
    message:
      `expected this workspace to have a spare seat; it has ${countOf(seatsPurchased, 'purchased seat')} and ` +
      `${countOf(committed, 'seat')} already committed (${countOf(position.memberCount, 'member')}, ` +
      `${countOf(position.pendingInvitations, 'invitation')} waiting), so one more needs ` +
      `${countOf(seatsNeeded, 'seat')} — ${countOf(additionalSeats, 'seat')} more at ` +
      `${usd(SEAT_PRICE_USD_CENTS)} per seat per month, ${usd(additionalMonthlyUsdCents)} a month extra. ` +
      'Add the seat from the billing page first. Issuing this invitation now would stop every member ' +
      'of the workspace from checkpointing the moment it is accepted, not just the person joining.',
  };
};

/**
 * The one thing seat management needs from the Stripe layer and does not own.
 *
 * `StripeSeatSync` in `checkout.ts` now implements this shape exactly, and migration `0037`
 * persists the subscription and item refs that `StripeClient.updateSeats` needs — so the only
 * thing still missing is a factory in `billing/runtime.ts` to construct it, which is a file
 * this lane does not own. Membership is written and tested against this interface rather than
 * against Stripe, so wiring the real one is a constructor argument, not a rewrite.
 *
 * The return type is `Promise<unknown>` rather than `Promise<void>` deliberately:
 * `StripeSeatSync.syncSeats` resolves to a `SeatSyncOutcome`, and `Promise<SeatSyncOutcome>`
 * is not assignable to `Promise<void>` — void's special return-position rule does not reach
 * inside a generic. Widening here is what lets the real implementation satisfy this interface
 * with no adapter.
 */
export interface SeatSubscriptionSync {
  syncSeats(input: {
    readonly workspaceId: string;
    readonly seats: number;
    readonly reason: 'member_invited' | 'member_joined' | 'member_removed';
  }): Promise<unknown>;
}

/**
 * A person in a workspace, as the team page and the removal decision need to see them.
 *
 * Two role systems exist and both matter. `team_member.role` is the coarse one the app
 * authorizes on today (`lead` | `member`), and `teamRoleForWorkspaceRole` collapses both
 * `owner` and `admin` into `lead` — so it cannot tell an owner from an admin, which is
 * exactly the distinction removal turns on. `workspace_member.role` is the fine one
 * (`owner` | `admin` | `member`) and is what `workspaceRole` carries.
 *
 * `kind` comes from the `actor` table, never from a request payload.
 */
export interface WorkspaceMemberSummary {
  readonly actorId: string;
  readonly identityId: string | null;
  readonly displayName: string;
  readonly kind: ActorKind;
  readonly workspaceRole: WorkspaceRole;
  readonly teamRole: TeamRole;
  readonly addedAt: Date;
  /** Live API tokens: not revoked, and not past their expiry. What removal will revoke. */
  readonly activeTokens: number;
}

export type RemovalRefusalCode = 'not_permitted' | 'last_owner' | 'member_not_found';

export interface RemovalParty {
  readonly actorId: string;
  readonly workspaceRole: WorkspaceRole;
  readonly displayName: string;
}

export interface RemovalRequest {
  readonly remover: RemovalParty;
  readonly target: RemovalParty;
  /** How many `owner` rows the workspace has, counted in the same transaction as the delete. */
  readonly ownerCount: number;
}

export type RemovalDecision =
  | { readonly permitted: true; readonly selfRemoval: boolean }
  | { readonly permitted: false; readonly code: RemovalRefusalCode; readonly message: string };

/**
 * Who may remove whom.
 *
 * The rules, in the order they are applied:
 *
 * 1. **The last owner is never removable**, including by themselves. A workspace with no
 *    owner has nobody who can invite, remove, or manage billing, and there is no recovery
 *    path in the product — `parseInvitableRole` refuses to grant `owner` through an
 *    invitation, so the role cannot be handed to anyone once it is gone. This guard is
 *    checked first precisely so it also catches self-removal.
 * 2. **Anyone may remove themselves.** Leaving a workspace is not an administrative act,
 *    and forcing a departing member to ask an admin to eject them is friction with no
 *    security value — they can already read everything they are leaving behind.
 * 3. **Otherwise: an owner may remove anyone; an admin may remove a member; nobody else may
 *    remove anybody.** So a member cannot remove an admin or an owner or another member,
 *    and an admin cannot remove a peer admin. Admin-removes-admin is refused deliberately:
 *    admins are peers, and letting one eject another turns a shared administrative role
 *    into a race. An owner is the tie-breaker for that case.
 *
 * Owner-removes-owner *is* allowed, guarded by rule 1. Refusing it would leave a departed
 * co-founder permanently attached to the workspace with no route to remove them, and rule 1
 * already prevents the only outcome that actually harms the workspace.
 */
export const decideRemoval = (request: RemovalRequest): RemovalDecision => {
  const { remover, target, ownerCount } = request;
  const selfRemoval = remover.actorId === target.actorId;

  if (target.workspaceRole === 'owner' && ownerCount <= 1) {
    return {
      permitted: false,
      code: 'last_owner',
      message:
        `expected the workspace to have another owner before ${selfRemoval ? 'you leave' : `${target.displayName} is removed`}; ` +
        'this is the only one. A workspace with no owner has nobody who can invite, remove, or manage billing, and an ' +
        'invitation cannot grant the owner role — so there would be no way back. Make someone else an owner first.',
    };
  }

  if (selfRemoval) {
    return { permitted: true, selfRemoval: true };
  }

  if (mayActOn(remover.workspaceRole, target.workspaceRole)) {
    return { permitted: true, selfRemoval: false };
  }

  return {
    permitted: false,
    code: 'not_permitted',
    message:
      `expected an owner, or an admin removing a member; this account is ${article(remover.workspaceRole)} ${remover.workspaceRole} ` +
      `and ${target.displayName} is ${article(target.workspaceRole)} ${target.workspaceRole}. ` +
      'An owner can remove anyone. An admin can remove a member, but not a peer admin or an owner. ' +
      'Ask an owner, or leave the workspace yourself if that is what you meant.',
  };
};

/**
 * Rank, so "promotion" and "demotion" mean something a guard can test.
 *
 * This is the only ordering of `workspace_role` in the codebase. It exists because
 * self-change is safe in one direction and an escalation in the other: an owner stepping
 * down to admin is legitimate, a member making themselves an admin is not.
 */
/** "an owner", "an admin", "a member" — only `member` takes "a". */
const article = (role: WorkspaceRole): string => (role === 'member' ? 'a' : 'an');

/**
 * The rank rule both `decideRemoval` and `decideRoleChange` are built on.
 *
 * An owner may act on anyone; an admin may act only on a member. Shared rather than written
 * twice so the two can never drift into disagreeing about who outranks whom — which would be
 * a security bug that looks like a copy-paste slip.
 */
const mayActOn = (actorRole: WorkspaceRole, targetRole: WorkspaceRole): boolean =>
  actorRole === 'owner' || (actorRole === 'admin' && targetRole === 'member');

export const WORKSPACE_ROLE_RANK: Readonly<Record<WorkspaceRole, number>> = {
  owner: 3,
  admin: 2,
  member: 1,
};

export type RoleChangeRefusalCode =
  | 'not_permitted'
  | 'last_owner'
  | 'role_unchanged'
  | 'member_not_found';

export interface RoleChangeRequest {
  readonly actor: RemovalParty;
  readonly target: RemovalParty;
  readonly newRole: WorkspaceRole;
  /** How many `owner` rows the workspace has, counted in the same transaction as the update. */
  readonly ownerCount: number;
}

export type RoleChangeDecision =
  | {
      readonly permitted: true;
      readonly selfChange: boolean;
      readonly direction: 'promotion' | 'demotion';
    }
  | { readonly permitted: false; readonly code: RoleChangeRefusalCode; readonly message: string };

/**
 * Who may set whose role, and to what.
 *
 * This deliberately reuses `decideRemoval`'s shape rather than introducing a second
 * authorization model: the same ranks, the same "an owner may act on anyone, an admin may
 * act on a member" rule, and the same last-owner invariant checked first. The two extra
 * rules are the ones a role change needs and a removal does not.
 *
 * The rules, in the order they are applied:
 *
 * 1. **The workspace must still have an owner afterwards.** Checked first, exactly as in
 *    `decideRemoval`, so it also catches the sole owner demoting *themselves* — which is the
 *    same orphaning as the sole owner deleting themselves, reached by a different route.
 * 2. **A no-op is refused rather than written.** Setting a role to what it already is would
 *    otherwise put a meaningless privilege-change row in the audit log, which is precisely
 *    the log someone reads when they are trying to work out who granted what.
 * 3. **Only an owner may grant `owner`.** Without this the whole model is decorative: an
 *    admin would simply promote themselves and then do anything an owner can do.
 * 4. **A self-change may only lower your own rank.** Stepping down is yours to do; stepping
 *    up is the escalation rule 3 exists to stop, and this closes the member-promotes-self
 *    path that rule 3 does not cover.
 * 5. **Otherwise: an owner may set anyone's role; an admin may set a member's.** Same as
 *    removal. An admin promoting a member to admin creates a peer they can no longer act on
 *    — an owner is the tie-breaker for that, exactly as with removal.
 *
 * Seats are untouched by any of this. A role change adds and removes no `team_member` row,
 * and `member_count` is a count over `team_member`, so the seat position and the Stripe
 * quantity are unaffected by construction rather than by remembering not to touch them.
 */
const wouldOrphan = (request: RoleChangeRequest): boolean =>
  request.target.workspaceRole === 'owner' &&
  request.newRole !== 'owner' &&
  request.ownerCount <= 1;

export const decideRoleChange = (request: RoleChangeRequest): RoleChangeDecision => {
  const { actor, target, newRole } = request;
  const selfChange = actor.actorId === target.actorId;
  const currentRank = WORKSPACE_ROLE_RANK[target.workspaceRole];
  const nextRank = WORKSPACE_ROLE_RANK[newRole];

  if (wouldOrphan(request)) {
    return {
      permitted: false,
      code: 'last_owner',
      message:
        `expected the workspace to keep at least one owner; ${selfChange ? 'you are' : `${target.displayName} is`} ` +
        `the only one, so ${selfChange ? 'stepping down to' : `changing them to`} ${newRole} would leave it with none. ` +
        'A workspace with no owner has nobody who can invite, remove, change roles, or manage billing, and an ' +
        'invitation cannot grant the owner role — so there would be no way back. Promote someone else to owner first.',
    };
  }

  if (newRole === target.workspaceRole) {
    return {
      permitted: false,
      code: 'role_unchanged',
      message:
        `expected a different role; ${selfChange ? 'you are' : `${target.displayName} is`} already ${article(newRole)} ${newRole}. ` +
        'Nothing was changed, and no privilege change was recorded.',
    };
  }

  if (newRole === 'owner' && actor.workspaceRole !== 'owner') {
    return {
      permitted: false,
      code: 'not_permitted',
      message:
        `expected an owner to grant the owner role; this account is ${article(actor.workspaceRole)} ${actor.workspaceRole}. ` +
        'Only an owner can create another owner — otherwise an admin could promote themselves and every other ' +
        'limit here would be decorative. Ask an owner.',
    };
  }

  if (selfChange) {
    if (nextRank < currentRank) {
      return { permitted: true, selfChange: true, direction: 'demotion' };
    }
    return {
      permitted: false,
      code: 'not_permitted',
      message:
        `expected a self-change to lower your own role; this would raise it from ${target.workspaceRole} to ${newRole}. ` +
        'You can step down, but you cannot promote yourself. Ask an owner.',
    };
  }

  if (mayActOn(actor.workspaceRole, target.workspaceRole)) {
    return {
      permitted: true,
      selfChange: false,
      direction: nextRank > currentRank ? 'promotion' : 'demotion',
    };
  }

  return {
    permitted: false,
    code: 'not_permitted',
    message:
      `expected an owner, or an admin changing a member; this account is ${article(actor.workspaceRole)} ${actor.workspaceRole} ` +
      `and ${target.displayName} is ${article(target.workspaceRole)} ${target.workspaceRole}. ` +
      "An owner can set anyone's role. An admin can set a member's, but not a peer admin's or an owner's. Ask an owner.",
  };
};
