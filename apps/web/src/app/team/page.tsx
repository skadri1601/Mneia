import Link from 'next/link';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher.js';
import { isSeatedPlan } from '../../server/billing/limits.js';
import {
  admitOneMoreSeat,
  type SeatAdmission,
  type SeatPosition,
  seatsCommitted,
} from '../../server/billing/seats.js';
import { SEAT_PRICE_USD_CENTS } from '../../server/billing/stripe.js';
import { accountStore, getCurrentAccount } from '../../server/current-account.js';
import { seats } from '../../server/membership-runtime.js';
import { inviteTeammateAction, revokeInvitationAction } from './actions.js';
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
};

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const ROLE_LABELS: Readonly<Record<string, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
};

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

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
  const [invitations, position] = await Promise.all([
    accountStore.listPendingInvitations({ workspaceId: account.workspace.id }),
    seats().seatPosition(scope),
  ]);

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
