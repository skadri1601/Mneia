import Link from 'next/link';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher.js';
import { accountStore, getCurrentAccount } from '../../server/current-account.js';
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
  invalid_role: 'Choose either lead or member.',
  already_invited: 'That address already has an invitation waiting. Revoke it to issue a new link.',
  invitation_not_found: 'That invitation was already accepted or revoked.',
};

const ROLE_LABELS: Readonly<Record<string, string>> = {
  lead: 'Lead',
  member: 'Member',
};

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

export default async function TeamPage({ searchParams }: TeamPageProps) {
  const [account, query] = await Promise.all([getCurrentAccount(), searchParams]);
  const invitations = await accountStore.listPendingInvitations({
    workspaceId: account.workspace.id,
  });

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

      {token === undefined ? null : (
        <section className={styles.card}>
          <h2>Send this link</h2>
          <p>
            It is shown once and never stored, so copy it now. Only the person whose verified email
            address you invited can use it.
          </p>
          <p className={styles.token}>{`/join/${token}`}</p>
        </section>
      )}

      <section className={styles.card}>
        <h2>Invite a colleague</h2>
        <form className={styles.form} action={inviteTeammateAction}>
          <div className={styles.field}>
            <label htmlFor="email">Their work email</label>
            <input id="email" name="email" type="email" maxLength={320} required />
          </div>
          <div className={styles.field}>
            <label htmlFor="role">Role on {account.team.displayName}</label>
            <select id="role" name="role" defaultValue="member">
              <option value="member">Member</option>
              <option value="lead">Lead</option>
            </select>
          </div>
          <button type="submit">Create invitation</button>
        </form>
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

      <Link className={styles.backLink} href="/projects">
        Back to projects
      </Link>
    </main>
  );
}
