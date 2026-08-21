import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { HandoffInboxEntry } from '../../../../server/browse-runtime.js';
import { BROWSE_LIMIT, browseHandoffInbox } from '../../../../server/browse-runtime.js';
import { getCurrentAccount } from '../../../../server/current-account.js';
import styles from '../browse.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HandoffsPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
}

const formatMinute = (at: Date): string => `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

function InboxSection({
  entries,
  heading,
  blurb,
  empty,
}: {
  readonly entries: readonly HandoffInboxEntry[];
  readonly heading: string;
  readonly blurb: string;
  readonly empty: string;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>
          {heading} ({entries.length})
        </h2>
        <p>{blurb}</p>
      </div>

      {entries.length === 0 ? (
        <p className={styles.empty}>{empty}</p>
      ) : (
        <ul className={styles.list}>
          {entries.map(({ handoff, fromName }) => (
            <li key={handoff.id} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.kind}>handoff</span>
                <span className={styles.status}>{formatMinute(handoff.createdAt)}</span>
              </div>
              <p className={styles.title}>
                <Link href={`/handoff/${handoff.id}`}>{handoff.nextAction}</Link>
              </p>
              <p className={styles.meta}>
                from {fromName} · {handoff.id.slice(0, 8)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function HandoffsPage({ params }: HandoffsPageProps) {
  const [{ projectId }, account] = await Promise.all([params, getCurrentAccount()]);

  const { project, addressed, open, truncated } = await browseHandoffInbox(
    { workspaceId: account.workspace.id, actorId: account.actor.id },
    projectId,
  );

  if (project === null) {
    return notFound();
  }

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1>Handoffs</h1>
        <p>
          Work waiting to be picked up on this project. Opening one does not claim it — receiving is
          a separate act, and today it happens with <code>mneia pickup &lt;id&gt;</code>.
        </p>
      </div>

      <InboxSection
        entries={addressed}
        heading="Addressed to you"
        blurb="Handed to you by name. Nobody else can receive these."
        empty="Nothing is addressed to you on this project."
      />

      <InboxSection
        entries={open}
        heading="Open to anyone"
        blurb="Left open by whoever created them. The first person to receive one claims it."
        empty="No open handoff is waiting."
      />

      {truncated ? (
        <p className={styles.truncated}>
          Showing the first {BROWSE_LIMIT}. An inbox this deep means handoffs are being created and
          never received.
        </p>
      ) : null}
    </div>
  );
}
