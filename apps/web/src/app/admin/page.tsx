import { notFound } from 'next/navigation';
import { admissionStore } from '../../server/admission-runtime.js';
import { currentUserIsSuperAdmin } from '../../server/super-admin.js';
import { approveSignupAction } from './actions.js';
import styles from './admin.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const PENDING_LIMIT = 200;

interface AdminPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const NOTICES: Readonly<Record<string, string>> = {
  invited: 'Invited, and the access email is on its way.',
  invited_without_email:
    'Invited, but the access email did not send. The send is recorded as unresolved — check Resend before retrying.',
  already_emailed: 'Already invited. No second email was sent.',
};

const ERRORS: Readonly<Record<string, string>> = {
  already_decided: 'That signup had already been decided.',
  signup_not_found: 'That signup no longer exists.',
  invitation_failed: 'Clerk refused to create the invitation. Nobody was emailed.',
  email_not_configured:
    'The access email is not configured, so nobody was approved. Set MNEIA_WAITLIST_FROM and RESEND_API_KEY.',
  approve_failed: 'The approval did not complete. Nothing was sent.',
};

const formatDate = (iso: string): string => iso.slice(0, 10);

export default async function AdminPage({ searchParams }: AdminPageProps) {
  if (!(await currentUserIsSuperAdmin())) {
    notFound();
  }

  const query = await searchParams;
  const pending = await admissionStore.listPending(PENDING_LIMIT);
  const notice = NOTICES[first(query.notice) ?? ''];
  const error = ERRORS[first(query.error) ?? ''];
  const email = first(query.email);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>Waitlist</p>
        <h1>Pending access requests</h1>
        <p>
          Approving creates a Clerk invitation and sends one email carrying its link. Every send is
          recorded, so approving twice never sends twice.
        </p>
      </header>

      {notice === undefined ? null : (
        <p className={styles.notice} role="status">
          {notice} {email === undefined ? null : <strong>{email}</strong>}
        </p>
      )}
      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {pending.length === 0 ? (
        <p className={styles.empty}>Nobody is waiting.</p>
      ) : (
        <table className={styles.queue}>
          <caption>
            {pending.length} waiting, oldest first
            {pending.length === PENDING_LIMIT ? ' (showing the first 200)' : ''}
          </caption>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Joined</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pending.map((signup) => (
              <tr key={signup.id}>
                <td>{signup.email}</td>
                <td>
                  <time dateTime={signup.createdAt}>{formatDate(signup.createdAt)}</time>
                </td>
                <td>
                  <form action={approveSignupAction}>
                    <input type="hidden" name="signupId" value={signup.id} />
                    <button type="submit">
                      Approve<span className={styles.visuallyHidden}> {signup.email}</span>
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
