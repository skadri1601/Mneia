import type { ContextItem, ItemKind, ItemStatus } from '@mneia/core';
import { ITEM_KINDS, ITEM_STATUSES } from '@mneia/core';
import { notFound } from 'next/navigation';
import { BROWSE_LIMIT, browseDecisions } from '../../../../server/browse-runtime.js';
import { getCurrentAccount } from '../../../../server/current-account.js';
import styles from '../browse.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DecisionsPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const asKind = (value: string | undefined): ItemKind | undefined =>
  ITEM_KINDS.find((kind) => kind === value);

const asStatus = (value: string | undefined): ItemStatus | undefined =>
  ITEM_STATUSES.find((status) => status === value);

const formatDate = (at: Date): string => at.toISOString().slice(0, 10);

const provenance = (item: ContextItem): string => {
  const parts = [
    item.humanConfirmed ? 'confirmed by a human' : 'not confirmed by a human',
    `asserted ${formatDate(item.assertedAt)}`,
    `confidence ${item.confidence.toFixed(2)}`,
  ];
  if (item.sourceRef !== null) {
    parts.push(item.sourceRef);
  }
  if (item.supersedesId !== null) {
    parts.push(`replaced ${item.supersedesId.slice(0, 8)}`);
  }
  if (item.supersededById !== null) {
    parts.push(`replaced by ${item.supersededById.slice(0, 8)}`);
  }
  return parts.join(' · ');
};

export default async function DecisionsPage({ params, searchParams }: DecisionsPageProps) {
  const [{ projectId }, query, account] = await Promise.all([
    params,
    searchParams,
    getCurrentAccount(),
  ]);

  const kind = asKind(first(query.kind));
  const status = asStatus(first(query.status));
  const loadBearingOnly = first(query.loadBearing) === 'true';
  const text = first(query.q)?.trim();

  const { project, items, truncated } = await browseDecisions(
    { workspaceId: account.workspace.id, actorId: account.actor.id },
    {
      projectId,
      ...(kind === undefined ? {} : { kinds: [kind] }),
      ...(status === undefined ? { statuses: ['active'] as const } : { statuses: [status] }),
      ...(loadBearingOnly ? { loadBearing: true } : {}),
      ...(text === undefined || text === '' ? {} : { text }),
    },
  );

  if (project === null) {
    notFound();
  }

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1>Decisions</h1>
        <p>
          What this project has settled, and who settled it. Read-only — an item changes through a
          checkpoint or the review queue, never here.
        </p>
      </header>

      <form className={styles.filters} method="get">
        <label className={styles.field}>
          <span>Kind</span>
          <select name="kind" defaultValue={kind ?? ''}>
            <option value="">Every kind</option>
            {ITEM_KINDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Status</span>
          <select name="status" defaultValue={status ?? 'active'}>
            {ITEM_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.field}>
          <span>Text</span>
          <input type="search" name="q" defaultValue={text ?? ''} placeholder="title or body" />
        </label>

        <label className={styles.checkbox}>
          <input type="checkbox" name="loadBearing" value="true" defaultChecked={loadBearingOnly} />
          <span>Load-bearing only</span>
        </label>

        <button type="submit" className={styles.apply}>
          Apply
        </button>
      </form>

      <p className={styles.count}>
        {items.length === 0
          ? 'No items match.'
          : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
      </p>

      {items.length === 0 ? (
        <p className={styles.empty}>
          Nothing here yet, or nothing matching those filters. Items arrive from a checkpoint.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.kind}>{item.kind}</span>
                {item.loadBearing ? <span className={styles.flag}>load-bearing</span> : null}
                {item.status === 'active' ? null : (
                  <span className={styles.status}>{item.status}</span>
                )}
              </div>
              <p className={styles.title}>{item.title}</p>
              {item.body === null ? null : <p className={styles.body}>{item.body}</p>}
              <p className={styles.meta}>{provenance(item)}</p>
            </li>
          ))}
        </ul>
      )}

      {truncated ? (
        <p className={styles.truncated}>
          Showing the first {BROWSE_LIMIT}. Narrow the filters to see the rest — this page does not
          page, on purpose, because a decision browser that needs paging needs better filters.
        </p>
      ) : null}
    </div>
  );
}
