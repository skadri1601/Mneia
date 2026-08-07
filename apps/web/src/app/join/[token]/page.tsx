import Link from 'next/link';
import { redeemInvitation } from '../../../server/account.js';
import {
  currentAccountDependencies,
  getCurrentAccount,
  verifiedEmailOf,
} from '../../../server/current-account.js';
import styles from './join.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface JoinPageProps {
  readonly params: Promise<{ readonly token: string }>;
}

const nonBlank = (value: string | null): string | null => {
  const candidate = value?.trim();
  return candidate === undefined || candidate === null || candidate.length === 0 ? null : candidate;
};

export default async function JoinPage({ params }: JoinPageProps) {
  const { token } = await params;
  const { userId } = await currentAccountDependencies.authenticate();
  const profile = await currentAccountDependencies.loadCurrentUser();
  const verifiedEmail = verifiedEmailOf(profile);
  const displayName = nonBlank(profile?.fullName ?? null) ?? verifiedEmail ?? userId ?? '';

  const joined =
    verifiedEmail === null
      ? null
      : await redeemInvitation({
          subject: userId,
          verifiedEmail,
          displayName,
          token,
          store: currentAccountDependencies.store,
        });

  if (joined !== null) {
    return (
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <p>{joined.workspace.displayName}</p>
          <h1>You are in</h1>
          <p>
            You joined {joined.workspace.displayName} as a {joined.membership.role} of{' '}
            {joined.team.displayName}. Everything the team has checkpointed is now yours to
            rehydrate.
          </p>
        </header>
        <Link className={styles.primaryLink} href="/projects">
          Open the workspace
        </Link>
      </main>
    );
  }

  const account = await getCurrentAccount();

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>{account.workspace.displayName}</p>
        <h1>This invitation cannot be accepted</h1>
        <p>
          {verifiedEmail === null
            ? 'Verify your email address with Clerk first — an invitation is only ever accepted by the verified address it was sent to.'
            : `It was not sent to ${verifiedEmail}, it has expired, it was revoked, or it was already used. It may also be that you already belong to ${account.workspace.displayName}, and a person can be in one workspace at a time.`}
        </p>
        <p>Ask whoever invited you to issue a new invitation to the address you signed in with.</p>
      </header>
      <Link className={styles.primaryLink} href="/projects">
        Go to your workspace
      </Link>
    </main>
  );
}
