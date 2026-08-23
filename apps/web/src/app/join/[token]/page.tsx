import Link from 'next/link';
import { redeemInvitation } from '../../../server/account.js';
import {
  currentAccountDependencies,
  getCurrentAccount,
  verifiedEmailOf,
} from '../../../server/current-account.js';
import { seats } from '../../../server/membership-runtime.js';
import { enterWorkspaceAction } from '../../workspace-actions.js';
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
    // Recorded after the fact, from the scope the acceptance produced. The invitation id is
    // not returned by `redeemInvitation`, so the record names the new member's membership
    // rather than the row that granted it; carrying the id out of the store transaction is
    // the durable fix and belongs with `PostgresAccountStore.redeemInvitation`.
    await seats().recordMembershipAudit(
      { workspaceId: joined.workspace.id, actorId: joined.actor.id },
      {
        action: 'membership.invitation_accepted',
        targetKind: 'workspace_invitation',
        targetId: null,
        metadata: { role: joined.membership.role, teamId: joined.team.id },
      },
    );

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
        <form action={enterWorkspaceAction}>
          <input name="workspaceId" type="hidden" value={joined.workspace.id} />
          <button className={styles.primaryLink} type="submit">
            Open the workspace
          </button>
        </form>
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
            : `It was not sent to ${verifiedEmail}, it has expired, it was revoked, it was already used, or you already belong to that workspace.`}
        </p>
        <p>Ask whoever invited you to issue a new invitation to the address you signed in with.</p>
      </header>
      <Link className={styles.primaryLink} href="/projects">
        Go to your workspace
      </Link>
    </main>
  );
}
