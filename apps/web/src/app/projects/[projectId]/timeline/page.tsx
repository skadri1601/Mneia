import type { ContextItem } from '@mneia/core';
import { notFound } from 'next/navigation';
import { BROWSE_LIMIT, readTimeline } from '../../../../server/browse-runtime.js';
import { getCurrentAccount } from '../../../../server/current-account.js';
import { diffBeliefs, parseAsOf } from '../../../../server/timeline-diff.js';
import styles from '../browse.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface TimelinePageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const formatDate = (at: Date): string => at.toISOString().slice(0, 10);

const believedLine = (item: ContextItem, asOf: Date): string => {
  const parts = [`asserted ${formatDate(item.assertedAt)}`];
  if (item.validTo !== null && item.validTo > asOf) {
    parts.push(`still believed then, retired ${formatDate(item.validTo)}`);
  }
  parts.push(item.humanConfirmed ? 'confirmed by a human' : 'never confirmed by a human');
  return parts.join(' · ');
};

export default async function TimelinePage({ params, searchParams }: TimelinePageProps) {
  const [{ projectId }, query, account] = await Promise.all([
    params,
    searchParams,
    getCurrentAccount(),
  ]);

  const raw = first(query.asOf);
  const { at: asOf, invalid } = parseAsOf(raw, new Date());

  const { project, believedThen, believedNow, truncated } = await readTimeline(
    { workspaceId: account.workspace.id, actorId: account.actor.id },
    { projectId, asOf },
  );

  if (project === null) {
    notFound();
  }

  const { then, since, noLongerHolds } = diffBeliefs(believedThen, believedNow);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>{account.workspace.displayName}</p>
        <h1>
          What {project.slug} believed on {formatDate(asOf)}
        </h1>
        <p>
          Read as of a date, not filtered by today&apos;s status. An item that has since been
          superseded still appears here, because on that date it was what the project believed.
        </p>
      </header>

      {invalid ? (
        <p className={styles.error} role="alert">
          {raw} is not a date this page can read. Use YYYY-MM-DD. Showing today instead.
        </p>
      ) : null}

      <form className={styles.filters} method="get">
        <label className={styles.field}>
          <span>As of</span>
          <input type="date" name="asOf" defaultValue={formatDate(asOf)} />
        </label>
        <button type="submit" className={styles.apply}>
          Read that day
        </button>
      </form>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Believed then — {then.length}</h2>
          <p>
            {noLongerHolds === 0
              ? 'All of it still holds today.'
              : `${noLongerHolds} of these no longer hold, marked on the left.`}
          </p>
        </div>

        {then.length === 0 ? (
          <p className={styles.empty}>
            Nothing had been recorded by then. The project&apos;s memory starts later than this
            date.
          </p>
        ) : (
          <ul className={styles.list}>
            {then.map((entry) => (
              <li
                key={entry.item.id}
                className={entry.changed ? `${styles.item} ${styles.changed}` : styles.item}
              >
                <div className={styles.itemHeader}>
                  <span className={styles.kind}>{entry.item.kind}</span>
                  {entry.item.loadBearing ? (
                    <span className={styles.flag}>load-bearing</span>
                  ) : null}
                  {entry.changed ? <span className={styles.status}>no longer holds</span> : null}
                </div>
                <p className={styles.title}>{entry.item.title}</p>
                <p className={styles.meta}>{believedLine(entry.item, asOf)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Believed since — {since.length}</h2>
          <p>Recorded after that date, so nobody working on that day could have known it.</p>
        </div>

        {since.length === 0 ? (
          <p className={styles.empty}>Nothing has been added since.</p>
        ) : (
          <ul className={styles.list}>
            {since.map((entry) => (
              <li key={entry.item.id} className={styles.item}>
                <div className={styles.itemHeader}>
                  <span className={styles.kind}>{entry.item.kind}</span>
                  {entry.item.loadBearing ? (
                    <span className={styles.flag}>load-bearing</span>
                  ) : null}
                </div>
                <p className={styles.title}>{entry.item.title}</p>
                <p className={styles.meta}>asserted {formatDate(entry.item.assertedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {truncated ? (
        <p className={styles.truncated}>
          One of the two sets hit the {BROWSE_LIMIT}-item ceiling, so this comparison is partial.
          Read a narrower window until the timeline pages properly.
        </p>
      ) : null}
    </main>
  );
}
