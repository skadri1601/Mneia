import { WORKSPACE_ROLES, type WorkspaceRole } from '@mneia/core';
import Link from 'next/link';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher.js';
import { isSeatedPlan } from '../../server/billing/limits.js';
import {
  admitOneMoreSeat,
  decideRemoval,
  decideRoleChange,
  type SeatAdmission,
  type SeatPosition,
  seatsCommitted,
  type WorkspaceMemberSummary,
} from '../../server/billing/seats.js';
import { SEAT_PRICE_USD_CENTS } from '../../server/billing/stripe.js';
import { accountStore, getCurrentAccount } from '../../server/current-account.js';
import { seats } from '../../server/membership-runtime.js';
import {
  changeRoleAction,
  inviteTeammateAction,
  removeMemberAction,
  revokeInvitationAction,
} from './actions.js';
import styles from './team.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface TeamPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const ERRORS: Readonly<Record<string, string>> = {
  invalid_email: 'Give a full email address, like name@company.com.',
  invalid_role: 'Choose either admin or member.',
  not_permitted: 'Only a workspace lead can invite or revoke. Ask a lead to do it.',
  already_invited: 'That address already has an invitation waiting. Revoke it to issue a new link.',
  invitation_not_found: 'That invitation was already accepted or revoked.',
  invite_email_failed:
    'The invitation was created but the email did not send. Copy the link below and send it yourself; it is the same link and it still works.',
  seats_exceeded:
    'No invitation was created, because this workspace has no spare seat. Add one from the billing page first — see the seat position above for what it costs.',
  last_owner:
    'Nobody was removed. This workspace has only one owner, and a workspace with no owner has nobody who can invite, remove, or manage billing. Make someone else an owner first.',
  member_not_found: 'Nothing changed. That person is not a member of this workspace any more.',
  role_unchanged: 'Nothing changed. They already hold that role.',
};

/** What each role actually lets someone do, stated where the granting happens. */
const ROLE_POWERS: Readonly<Record<WorkspaceRole, string>> = {
  owner:
    'can invite and remove anyone, change any role, grant and revoke ownership, and manage billing',
  admin:
    "can invite people, remove members, and change a member's role — but cannot touch admins or owners",
  member: 'can use the workspace; cannot invite, remove, or change roles',
};

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** "an owner", "an admin", "a member" — only `member` takes "a". */
const article = (role: WorkspaceRole): string => (role === 'member' ? 'a' : 'an');

const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

interface RemovalConfirmationProps {
  readonly member: WorkspaceMemberSummary;
  readonly isYou: boolean;
}

/**
 * The second of the two deliberate steps a removal costs.
 *
 * It states the three consequences that are not obvious from a button labelled "Remove":
 * access goes immediately, the person's API tokens stop working, and their contributions to
 * the workspace's memory stay and stay attributed to them. Only this panel carries the form
 * that posts, so nothing destructive is one click away from the list.
 */
function RemovalConfirmation({ member, isYou }: RemovalConfirmationProps) {
  const tokens =
    member.activeTokens === 0
      ? 'There are no API tokens to revoke.'
      : `${member.activeTokens} API token${member.activeTokens === 1 ? '' : 's'} will be revoked and stop working at once.`;

  return (
    <li className={styles.confirm}>
      <p className={styles.confirmTitle}>
        {isYou ? 'Leave this workspace?' : `Remove ${member.displayName}?`}
      </p>
      <p>
        {isYou
          ? 'You will lose access to this workspace immediately.'
          : `${member.displayName} will lose access to this workspace immediately.`}{' '}
        {tokens} Checkpoints, decisions and constraints {isYou ? 'you' : 'they'} recorded stay in
        the workspace, still attributed to {isYou ? 'you' : 'them'}. This frees a seat.
      </p>
      <div className={styles.confirmActions}>
        <form action={removeMemberAction}>
          <input type="hidden" name="actorId" value={member.actorId} />
          <button type="submit" className={styles.destructive}>
            {isYou ? 'Yes, leave' : `Yes, remove ${member.displayName}`}
          </button>
        </form>
        <Link className={styles.backLink} href="/team">
          Cancel
        </Link>
      </div>
    </li>
  );
}

interface RoleChangeProps {
  readonly member: WorkspaceMemberSummary;
  readonly isYou: boolean;
  readonly options: readonly WorkspaceRole[];
}

/**
 * The confirmation step for a privilege change.
 *
 * Each permissible role is its own submit button carrying its own hidden inputs, with what
 * that role can actually do stated next to it — so the grant is read before it is made
 * rather than inferred from a word. Only roles the server would accept are rendered, and the
 * server re-decides regardless.
 */
function RoleChange({ member, isYou, options }: RoleChangeProps) {
  return (
    <li className={styles.confirm}>
      <p className={styles.confirmTitle}>
        {isYou ? 'Change your own role?' : `Change ${member.displayName}'s role?`}
      </p>
      <p>
        {isYou ? 'You are' : `${member.displayName} is`} {article(member.workspaceRole)}{' '}
        {member.workspaceRole} today. Changing this takes effect immediately. It does not change the
        number of seats this workspace pays for.
      </p>
      {options.length === 0 ? (
        <p>There is no role you can move {isYou ? 'yourself' : 'them'} to.</p>
      ) : (
        <div className={styles.confirmActions}>
          {options.map((role) => (
            <form action={changeRoleAction} key={role}>
              <input type="hidden" name="actorId" value={member.actorId} />
              <input type="hidden" name="role" value={role} />
              <button type="submit" className={styles.destructive}>
                {`Make ${isYou ? 'me' : member.displayName} ${article(role)} ${role}`}
              </button>
            </form>
          ))}
        </div>
      )}
      <ul className={styles.rolePowers}>
        {options.map((role) => (
          <li key={role}>
            <strong>{ROLE_LABELS[role] ?? role}</strong> {ROLE_POWERS[role]}
          </li>
        ))}
      </ul>
      <Link className={styles.backLink} href="/team">
        Cancel
      </Link>
    </li>
  );
}

interface MemberRowProps {
  readonly member: WorkspaceMemberSummary;
  readonly isYou: boolean;
  readonly removable: boolean;
  readonly roleChangeable: boolean;
}

function MemberRow({ member, isYou, removable, roleChangeable }: MemberRowProps) {
  const kind = member.kind === 'human' ? '' : ` \u00b7 ${member.kind}`;
  const tokens =
    member.activeTokens === 0
      ? ''
      : ` \u00b7 ${member.activeTokens} active token${member.activeTokens === 1 ? '' : 's'}`;

  return (
    <li className={styles.invitation}>
      <div>
        <p className={styles.invitationEmail}>
          {member.displayName}
          {isYou ? ' (you)' : ''}
        </p>
        <p className={styles.invitationMeta}>
          {ROLE_LABELS[member.workspaceRole] ?? member.workspaceRole}
          {kind} {'\u00b7'} joined {formatDate(member.addedAt)}
          {tokens}
        </p>
      </div>
      <div className={styles.rowActions}>
        {roleChangeable ? (
          <Link className={styles.revoke} href={`/team?role=${member.actorId}`}>
            Change role
          </Link>
        ) : null}
        {removable ? (
          <Link className={styles.revoke} href={`/team?confirm=${member.actorId}`}>
            {isYou ? 'Leave' : 'Remove'}
          </Link>
        ) : null}
      </div>
    </li>
  );
}

interface MembersCardProps {
  readonly members: readonly WorkspaceMemberSummary[];
  readonly viewer: WorkspaceMemberSummary | undefined;
  readonly ownerCount: number;
  readonly confirming: string | undefined;
  readonly changingRole: string | undefined;
}

/**
 * The people in the workspace, and the one destructive control on this page.
 *
 * Removal is confirmed in-page rather than with a browser `confirm()`: a `?confirm=<actorId>`
 * link swaps that row for a panel stating exactly what will happen, and only that panel
 * carries the form that posts. So the destructive action always costs two deliberate steps,
 * needs no client JavaScript, and the consequences are read at the moment of deciding.
 *
 * The same `decideRemoval` the store uses decides what is offered here, so the page cannot
 * present a control the server would refuse. The server still decides for real — this only
 * governs what is shown.
 */
function MembersCard({ members, viewer, ownerCount, confirming, changingRole }: MembersCardProps) {
  // Only roles the server would actually accept are offered, decided with the same function
  // the store calls. The server still decides for real.
  const rolesFor = (member: WorkspaceMemberSummary): readonly WorkspaceRole[] => {
    if (viewer === undefined) return [];
    return WORKSPACE_ROLES.filter(
      (role) =>
        decideRoleChange({
          actor: {
            actorId: viewer.actorId,
            workspaceRole: viewer.workspaceRole,
            displayName: viewer.displayName,
          },
          target: {
            actorId: member.actorId,
            workspaceRole: member.workspaceRole,
            displayName: member.displayName,
          },
          newRole: role,
          ownerCount,
        }).permitted,
    );
  };

  // Which panel, if any, this row is currently expanded into. A query param only opens a
  // panel the viewer is actually allowed to act through.
  const panelFor = (
    actorId: string,
    removable: boolean,
    roleChangeable: boolean,
  ): 'removal' | 'role' | 'row' => {
    if (confirming === actorId && removable) return 'removal';
    if (changingRole === actorId && roleChangeable) return 'role';
    return 'row';
  };

  const mayRemove = (member: WorkspaceMemberSummary): boolean => {
    if (viewer === undefined) return false;
    return decideRemoval({
      remover: {
        actorId: viewer.actorId,
        workspaceRole: viewer.workspaceRole,
        displayName: viewer.displayName,
      },
      target: {
        actorId: member.actorId,
        workspaceRole: member.workspaceRole,
        displayName: member.displayName,
      },
      ownerCount,
    }).permitted;
  };

  return (
    <section className={styles.card} aria-labelledby="members">
      <h2 id="members">People</h2>
      {members.length === 0 ? (
        <p>Nobody is in this workspace yet.</p>
      ) : (
        <ul className={styles.invitationList}>
          {members.map((member) => {
            const isYou = member.actorId === viewer?.actorId;
            const removable = mayRemove(member);
            const roleOptions = rolesFor(member);
            const panel = panelFor(member.actorId, removable, roleOptions.length > 0);

            if (panel === 'removal') {
              return <RemovalConfirmation key={member.actorId} member={member} isYou={isYou} />;
            }
            if (panel === 'role') {
              return (
                <RoleChange
                  key={member.actorId}
                  member={member}
                  isYou={isYou}
                  options={roleOptions}
                />
              );
            }
            return (
              <MemberRow
                key={member.actorId}
                member={member}
                isYou={isYou}
                removable={removable}
                roleChangeable={roleOptions.length > 0}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface SeatCardProps {
  readonly position: SeatPosition;
  readonly refusal: Extract<SeatAdmission, { admitted: false }> | null;
}

/**
 * The seat position, stated in the terms the bill is in: who is here, who is on the way,
 * and what one more person costs.
 *
 * Its own component because it is the only part of this page with real arithmetic, and
 * because `quota.ts` refusing `seats_exceeded` is invisible until someone tries to
 * checkpoint — this is where a lead is supposed to see it coming.
 */
function SeatCard({ position, refusal }: SeatCardProps) {
  const seatPriced = isSeatedPlan(position.plan);

  return (
    <section className={styles.card} aria-labelledby="seat-position">
      <h2 id="seat-position">Seats</h2>
      <dl className={styles.facts}>
        <div>
          <dt>Members</dt>
          <dd>{position.memberCount}</dd>
        </div>
        <div>
          <dt>Invitations waiting</dt>
          <dd>{position.pendingInvitations}</dd>
        </div>
        <div>
          <dt>Seats committed</dt>
          <dd>{seatsCommitted(position)}</dd>
        </div>
        <div>
          <dt>Seats purchased</dt>
          <dd>{seatPriced ? (position.seatsPurchased ?? 0) : 'Not seat-priced'}</dd>
        </div>
      </dl>
      {seatPriced ? (
        <p>
          {refusal === null
            ? `Adding one more person is covered by a seat you already pay for. Each seat is ${usd(SEAT_PRICE_USD_CENTS)} a month.`
            : `Adding one more person needs a seat this workspace has not bought. Each seat is ${usd(SEAT_PRICE_USD_CENTS)} a month.`}
        </p>
      ) : (
        <p>
          This workspace is on the {position.plan} plan, which is not billed per seat, so inviting a
          colleague costs nothing. Team is {usd(SEAT_PRICE_USD_CENTS)} per seat per month.
        </p>
      )}
      {refusal === null ? null : (
        <p className={styles.seatWarning}>
          {`Buy ${refusal.additionalSeats} more seat${refusal.additionalSeats === 1 ? '' : 's'} — ${usd(refusal.additionalMonthlyUsdCents)} a month extra — before inviting anyone else. Until then no new invitation is created, because accepting one would stop every member of this workspace from checkpointing, not just the person joining.`}
        </p>
      )}
      <Link className={styles.backLink} href="/billing">
        Manage seats and billing
      </Link>
    </section>
  );
}

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const [account, query] = await Promise.all([getCurrentAccount(), searchParams]);
  const scope = { workspaceId: account.workspace.id, actorId: account.actor.id };
  const [invitations, position, members] = await Promise.all([
    accountStore.listPendingInvitations({ workspaceId: account.workspace.id }),
    seats().seatPosition(scope),
    seats().listMembers(scope),
  ]);

  // The viewer's own row is the authority on what they may do — `account.membership` carries
  // only the coarse team role, which collapses owner and admin into `lead`.
  const viewer = members.find((member) => member.actorId === account.actor.id);
  const ownerCount = members.filter((member) => member.workspaceRole === 'owner').length;

  // What the *next* invitation would do, computed the same way `inviteTeammateAction`
  // computes it, so the page and the refusal can never disagree about whether there is room.
  const admission = position === null ? null : admitOneMoreSeat(position);
  const refusal = admission !== null && !admission.admitted ? admission : null;

  const error = ERRORS[first(query.error) ?? ''];
  const notice = first(query.notice);
  const token = first(query.token);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>{account.workspace.displayName}</p>
        <WorkspaceSwitcher current={account.workspace.id} workspaces={account.workspaces} />
        <h1>Team</h1>
        <p>
          Invite a colleague and they land in this workspace, not one of their own. An invitation is
          single use, expires in seven days, and can only be accepted by the address it was sent to.
        </p>
      </header>

      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {notice === 'role_changed' ? (
        <p className={styles.notice} role="status">
          Role updated{first(query.role) === undefined ? '' : ` to ${first(query.role)}`}. Seats are
          unchanged.
        </p>
      ) : null}
      {first(query.seat_sync) === 'failed' ? (
        <p className={styles.error} role="alert">
          The member was removed and their API tokens were revoked — that part is done. But we could
          not reach Stripe to release the seat, so this workspace may still be billed for it. Open
          the billing portal to check the quantity, or try removing someone else later to trigger
          another sync. The failure has been reported.
        </p>
      ) : null}
      {notice === 'removed' ? (
        <p className={styles.notice} role="status">
          Removed. Their seat is free and their API tokens no longer work.
        </p>
      ) : null}
      {notice === 'revoked' ? (
        <p className={styles.notice} role="status">
          Invitation revoked.
        </p>
      ) : null}
      {notice === 'invited' ? (
        <p className={styles.notice} role="status">
          Invitation emailed. The link below is the same one it carries.
        </p>
      ) : null}

      {token === undefined ? null : (
        <section className={styles.card}>
          <h2>The join link</h2>
          <p>
            It is shown once and never stored. The invited address has been emailed this link; copy
            it if you would rather send it yourself. Only the person whose verified email address
            you invited can use it.
          </p>
          <p className={styles.token}>{`/join/${token}`}</p>
        </section>
      )}

      {position === null ? null : <SeatCard position={position} refusal={refusal} />}

      <MembersCard
        members={members}
        viewer={viewer}
        ownerCount={ownerCount}
        confirming={first(query.confirm)}
        changingRole={first(query.role)}
      />

      <section className={styles.card}>
        <h2>Invite a colleague</h2>
        {account.membership.role !== 'lead' ? (
          <p>Only a workspace lead can invite people. Ask one of yours to send the invitation.</p>
        ) : (
          <form className={styles.form} action={inviteTeammateAction}>
            <div className={styles.field}>
              <label htmlFor="email">Their work email</label>
              <input id="email" name="email" type="email" maxLength={320} required />
            </div>
            <div className={styles.field}>
              <label htmlFor="role">Role in {account.workspace.displayName}</label>
              <select id="role" name="role" defaultValue="member">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            {/* Disabled rather than hidden: a lead who cannot invite should be able to see
                why, and the server refuses the same case regardless of what is submitted. */}
            <button type="submit" disabled={refusal !== null}>
              Create invitation
            </button>
            {refusal === null ? null : <p>Buy a seat from the billing page to re-enable this.</p>}
          </form>
        )}
      </section>

      <section className={styles.card}>
        <h2>Waiting to be accepted</h2>
        {invitations.length === 0 ? (
          <p>Nobody has an invitation open right now.</p>
        ) : (
          <ul className={styles.invitationList}>
            {invitations.map((invitation) => (
              <li key={invitation.id} className={styles.invitation}>
                <div>
                  <p className={styles.invitationEmail}>{invitation.invitedEmail}</p>
                  <p className={styles.invitationMeta}>
                    {ROLE_LABELS[invitation.role] ?? invitation.role} · expires{' '}
                    {formatDate(invitation.expiresAt)}
                  </p>
                </div>
                <form action={revokeInvitationAction}>
                  <input type="hidden" name="invitationId" value={invitation.id} />
                  <button type="submit" className={styles.revoke}>
                    Revoke
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link className={styles.backLink} href="/tokens">
        API tokens
      </Link>
      <Link className={styles.backLink} href="/projects">
        Back to projects
      </Link>
    </main>
  );
}
