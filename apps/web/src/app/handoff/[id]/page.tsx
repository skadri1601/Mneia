import type { ContextItem, HandoffItem } from '@mneia/core';
import { notFound } from 'next/navigation';
import { browseHandoff } from '../../../server/browse-runtime.js';
import { getCurrentAccount } from '../../../server/current-account.js';
import styles from './handoff.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface HandoffPageProps {
  readonly params: Promise<{ readonly id: string }>;
}

const formatDate = (at: Date): string => at.toISOString().slice(0, 10);

const formatMinute = (at: Date): string => `${at.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const changedSince = (item: ContextItem, frozenAt: Date): boolean =>
  item.status !== 'active' ||
  item.supersededById !== null ||
  (item.validTo !== null && item.validTo.getTime() <= Date.now()) ||
  (item.lastVerifiedAt !== null && item.lastVerifiedAt.getTime() > frozenAt.getTime());

const currentState = (item: ContextItem): string => {
  if (item.supersededById !== null) {
    return `superseded by ${item.supersededById.slice(0, 8)}`;
  }
  if (item.status !== 'active') {
    return item.status;
  }
  return 'still active';
};

const groupBySection = (
  items: readonly HandoffItem[],
): readonly (readonly [string, readonly HandoffItem[]])[] => {
  const sections = new Map<string, HandoffItem[]>();
  for (const entry of items) {
    const existing = sections.get(entry.section);
    if (existing === undefined) {
      sections.set(entry.section, [entry]);
    } else {
      existing.push(entry);
    }
  }
  return [...sections.entries()];
};

export default async function HandoffPage({ params }: HandoffPageProps) {
  const [{ id }, account] = await Promise.all([params, getCurrentAccount()]);

  const { handoff, project, items } = await browseHandoff(
    { workspaceId: account.workspace.id, actorId: account.actor.id },
    id,
  );

  if (handoff === null) {
    notFound();
  }

  const changed = items.filter((entry) => changedSince(entry.item, handoff.createdAt));

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1>Handoff</h1>
        <p>
          {project === null ? 'A project you cannot see' : project.slug} ·{' '}
          {handoff.toActor === null ? 'open' : `to ${handoff.toActor.slice(0, 8)}`} ·{' '}
          {handoff.receivedAt === null
            ? 'not yet received'
            : `received ${formatMinute(handoff.receivedAt)}`}
        </p>
      </header>

      <section className={styles.frozen}>
        <h2>What was handed over</h2>
        <p className={styles.label}>
          Frozen {formatMinute(handoff.createdAt)}. This is exactly what the receiver was given and
          it does not change.
        </p>
        <pre className={styles.rendered}>{handoff.rendered}</pre>
      </section>

      <section className={styles.live}>
        <h2>Where those items stand now</h2>
        <p className={styles.label}>
          Live. Read from the project as it is today, not from the artifact above — this is the half
          that moves.
        </p>

        {changed.length === 0 ? (
          <p className={styles.unchanged}>
            {items.length === 0
              ? 'This handoff recorded no items, so there is nothing to follow.'
              : 'Nothing in this handoff has changed since it was frozen.'}
          </p>
        ) : (
          <p className={styles.drift}>
            {changed.length === 1
              ? '1 item has changed since this was frozen.'
              : `${changed.length} items have changed since this was frozen.`}
          </p>
        )}

        {groupBySection(items).map(([section, entries]) => (
          <div key={section} className={styles.section}>
            <h3>{section}</h3>
            <ul className={styles.items}>
              {entries.map((entry) => (
                <li
                  key={entry.item.id}
                  className={
                    changedSince(entry.item, handoff.createdAt) ? styles.itemChanged : styles.item
                  }
                >
                  <span className={styles.title}>{entry.item.title}</span>
                  <span className={styles.meta}>
                    {currentState(entry.item)} ·{' '}
                    {entry.item.humanConfirmed ? 'human-confirmed' : 'unconfirmed'} · asserted{' '}
                    {formatDate(entry.item.assertedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
