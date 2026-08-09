import { getCurrentAccount } from '../../../../server/current-account.js';
import { pendingReviewItems } from '../../../../server/review-runtime.js';
import { reviewPendingAction } from './actions.js';
import styles from './review.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface ReviewPageProps {
  readonly params: Promise<{ readonly projectId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const ERRORS: Readonly<Record<string, string>> = {
  nothing_decided:
    'Nothing was decided, so nothing was written. Choose keep or discard on at least one item.',
  invalid_argument: 'That review could not be applied. Reload the queue and try again.',
  failed: 'The review did not complete. Nothing was written.',
};

const WHY_ASKED = (item: {
  readonly loadBearing: boolean;
  readonly assertedByKind: string;
}): string => {
  if (item.loadBearing) {
    return 'Load-bearing: later work is wrong if this is wrong, so §10.1 requires a human to confirm it.';
  }
  return item.assertedByKind === 'agent'
    ? 'Asserted by an agent, so a human decides whether it is kept.'
    : 'Awaiting confirmation.';
};

export default async function ReviewPage({ params, searchParams }: ReviewPageProps) {
  const [{ projectId }, query, account] = await Promise.all([
    params,
    searchParams,
    getCurrentAccount(),
  ]);

  const items = await pendingReviewItems(
    { workspaceId: account.workspace.id, actorId: account.actor.id },
    projectId,
  );

  const notice = first(query.notice);
  const count = first(query.count);
  const error = first(query.error);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <h1>Review queue</h1>
        <p>
          Items an extraction proposed and nobody has confirmed yet. Anyone on the team can review
          them — you do not have to have done the work they came from.
        </p>
      </header>

      {notice === 'reviewed' ? (
        <p className={styles.notice} role="status">
          Reviewed {count ?? ''} {count === '1' ? 'item' : 'items'}.
        </p>
      ) : null}
      {error !== undefined ? (
        <p className={styles.error} role="alert">
          {ERRORS[error] ?? ERRORS.failed}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className={styles.empty}>
          Nothing is waiting. Items appear here when a checkpoint proposes something load-bearing or
          contradicting, which is the only kind that needs a person.
        </p>
      ) : (
        <form action={reviewPendingAction} className={styles.queue}>
          <input type="hidden" name="projectId" value={projectId} />

          {items.map((item) => (
            <fieldset key={item.id} className={styles.item}>
              <input type="hidden" name="itemId" value={item.id} />

              <legend className={styles.itemHeader}>
                <span className={styles.kind}>{item.kind}</span>
                {item.loadBearing ? <span className={styles.flag}>load-bearing</span> : null}
                <span className={styles.actor}>
                  {item.assertedByName} ({item.assertedByKind})
                </span>
                <span className={styles.confidence}>confidence {item.confidence.toFixed(2)}</span>
              </legend>

              <p className={styles.why}>{WHY_ASKED(item)}</p>

              <label className={styles.field}>
                <span>Title</span>
                <input type="text" name={`title:${item.id}`} defaultValue={item.title} />
              </label>

              <label className={styles.field}>
                <span>Body</span>
                <textarea name={`body:${item.id}`} rows={3} defaultValue={item.body ?? ''} />
              </label>

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  name={`loadBearing:${item.id}`}
                  defaultChecked={item.loadBearing}
                />
                <span>Load-bearing</span>
              </label>

              <div className={styles.decision} role="radiogroup" aria-label="Decision">
                <label>
                  <input type="radio" name={`decision:${item.id}`} value="accept" defaultChecked />
                  <span>Keep</span>
                </label>
                <label>
                  <input type="radio" name={`decision:${item.id}`} value="reject" />
                  <span>Discard</span>
                </label>
              </div>
            </fieldset>
          ))}

          <button type="submit" className={styles.submit}>
            Apply {items.length} {items.length === 1 ? 'decision' : 'decisions'}
          </button>
        </form>
      )}
    </div>
  );
}
