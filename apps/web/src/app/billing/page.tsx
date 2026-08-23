import { randomUUID } from 'node:crypto';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher.js';
import { subscriptionAddress } from '../../server/billing/billing-store.js';
import { canOpenPortal, canStartCheckout } from '../../server/billing/checkout.js';
import { isSeatedPlan } from '../../server/billing/limits.js';
import { effectiveAllowances } from '../../server/billing/quota.js';
import { billingStore, quotaStore } from '../../server/billing/runtime.js';
import { getCurrentAccount } from '../../server/current-account.js';
import { checkoutAction, portalAction, purchaseSeatsAction } from './actions.js';
import styles from './Billing.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BillingPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const title = (value: string): string => value.slice(0, 1).toUpperCase() + value.slice(1);

const count = (value: number): string => value.toLocaleString('en-US');

/**
 * One dial, as `used of allowance`.
 *
 * A null allowance is unmetered, and saying so is not the same as saying zero — a plan
 * with no ceiling must not render as one that has been exhausted.
 */
const meter = (used: number, allowance: number | null): string =>
  allowance === null ? `${count(used)} used — unmetered` : `${count(used)} of ${count(allowance)}`;

/** The reset instant, as a date a person reads rather than the ISO string the API returns. */
const resetDate = (at: Date): string =>
  at.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });

const dollars = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const account = await getCurrentAccount();
  // Read together: both are one indexed query against workspace under the same scope, and
  // this page is not on the rehydrate path, so there is no §12.1 budget to protect here.
  const store = billingStore();
  const [snapshot, subscription, quota, query] = await Promise.all([
    store.snapshot(account.workspace.id),
    store.subscriptionRef(account.workspace.id),
    quotaStore().quotaFor(account.workspace.id, new Date()),
    searchParams,
  ]);
  if (snapshot === null || quota === null) {
    throw new Error('expected the authenticated workspace to have a billing snapshot; found none');
  }

  const allowances = effectiveAllowances(quota);

  const billingAccount = {
    workspaceId: account.workspace.id,
    role: account.membership.role,
  } as const;
  const checkoutAvailable = canStartCheckout({ account: billingAccount, snapshot });
  const portalAvailable = canOpenPortal({ account: billingAccount, snapshot });
  const checkoutNotice = first(query.checkout);
  const seatNotice = first(query.seats);

  // Reuses canOpenPortal rather than restating its status set: seat sync and the portal
  // gate on the same three statuses (active, trialing, past_due) for the same reason, and
  // a second copy of that list here would drift from SYNCABLE_STATUSES in checkout.ts.
  const seatControlAvailable = portalAvailable && isSeatedPlan(snapshot.plan);
  // Both halves, or neither. Migration 0036 writes these from the live Stripe object in the
  // subscription webhook, so a workspace that subscribed before it fills in on its next
  // lifecycle event — which is a real state a lead can be sitting in right now.
  const address = subscription === null ? null : subscriptionAddress(subscription);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>{account.workspace.displayName}</p>
        <WorkspaceSwitcher current={account.workspace.id} workspaces={account.workspaces} />
        <h1>Billing</h1>
        <p>Individual access is free. Team billing is managed by your workspace lead.</p>
      </header>

      {checkoutNotice === 'success' ? (
        <p className={styles.notice} role="status">
          Checkout completed.
        </p>
      ) : null}
      {checkoutNotice === 'canceled' ? (
        <p className={styles.notice} role="status">
          Checkout canceled.
        </p>
      ) : null}
      {seatNotice === 'updated' ? (
        <p className={styles.notice} role="status">
          Seat count updated. The subscription now bills for the seats shown below.
        </p>
      ) : null}
      {seatNotice === 'unchanged' ? (
        <p className={styles.notice} role="status">
          No seat change was applied — the subscription already bills for that many seats.
        </p>
      ) : null}

      <section className={styles.card} aria-labelledby="billing-summary">
        <h2 id="billing-summary">Workspace billing</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Current plan</dt>
            <dd>{title(snapshot.plan)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{title(snapshot.billingStatus.replace('_', ' '))}</dd>
          </div>
          <div>
            <dt>Accepted members</dt>
            <dd>{snapshot.memberCount}</dd>
          </div>
          <div>
            <dt>Seats</dt>
            {/*
              Purchased seats, not the member count standing in for them. Showing members
              under a "Seats" label told an unsubscribed workspace it had seats it had
              never bought, and on Team it is the purchased count the quota pools against.
            */}
            <dd>
              {snapshot.seatsPurchased === null
                ? 'None purchased'
                : `${count(snapshot.memberCount)} of ${count(snapshot.seatsPurchased)} purchased`}
            </dd>
          </div>
        </dl>
      </section>

      <section className={styles.card} aria-labelledby="billing-usage">
        <h2 id="billing-usage">This period</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Extractions</dt>
            <dd>{meter(quota.extractionsUsed, allowances.extractions)}</dd>
          </div>
          <div>
            <dt>Turns</dt>
            <dd>{meter(quota.turnsUsed, allowances.turns)}</dd>
          </div>
          <div>
            <dt>Embedding tokens</dt>
            <dd>{meter(quota.embeddingTokensUsed, allowances.embeddingTokens)}</dd>
          </div>
          <div>
            <dt>Prepaid balance</dt>
            <dd>{dollars(quota.walletBalanceMicros)}</dd>
          </div>
          <div>
            <dt>Resets</dt>
            <dd>{resetDate(quota.period.end)}</dd>
          </div>
        </dl>
        {/*
          Said out loud rather than left for a customer to infer from a dial that never
          moves: nothing in the product writes embedding_tokens_used, and nothing credits
          wallet_balance_micros, so both read zero for every workspace today.
        */}
        <p>
          Embedding usage is not yet recorded, so that dial reads zero. Prepaid balance can
          currently only be credited by us — there is no self-serve top-up.
        </p>
      </section>

      {account.membership.role !== 'lead' ? (
        <p className={styles.access}>Only a workspace lead can manage billing.</p>
      ) : null}

      {checkoutAvailable ? (
        <section className={styles.card} aria-labelledby="team-checkout">
          <h2 id="team-checkout">Team checkout</h2>
          <p>Checkout starts with the {snapshot.memberCount} accepted members in this workspace.</p>
          <form action={checkoutAction} className={styles.form}>
            <input name="attemptToken" type="hidden" value={randomUUID()} />
            <button type="submit">Start Team checkout</button>
          </form>
        </section>
      ) : null}

      {seatControlAvailable && address !== null ? (
        <section className={styles.card} aria-labelledby="seat-count">
          <h2 id="seat-count">Seats</h2>
          <p>
            This workspace pays for {count(snapshot.seatsPurchased ?? 0)} seat
            {snapshot.seatsPurchased === 1 ? '' : 's'} and has {count(snapshot.memberCount)}{' '}
            accepted member{snapshot.memberCount === 1 ? '' : 's'}. Changing this bills the
            difference for the rest of the period; releasing a seat is credited against the next
            invoice.
          </p>
          <form action={purchaseSeatsAction} className={styles.form}>
            <label htmlFor="seats">Seats to pay for</label>
            <input
              id="seats"
              name="seats"
              type="number"
              min={Math.max(snapshot.memberCount, 1)}
              step={1}
              defaultValue={snapshot.seatsPurchased ?? snapshot.memberCount}
            />
            <button type="submit">Update seat count</button>
          </form>
        </section>
      ) : null}

      {seatControlAvailable && address === null ? (
        <section className={styles.card} aria-labelledby="seat-count-unavailable">
          <h2 id="seat-count-unavailable">Seats</h2>
          {/*
            Said rather than hidden. A control that silently fails is worse than an absent
            one, and an empty panel would read as a bug. This resolves itself.
          */}
          <p>
            Seat changes are not available yet for this workspace. Its Stripe subscription reference
            has not been recorded, which happens on the subscription&rsquo;s next lifecycle event —
            a renewal, a payment, or a change made from the billing portal. Until then, use the
            billing portal below.
          </p>
        </section>
      ) : null}

      {portalAvailable ? (
        <section className={styles.card} aria-labelledby="manage-subscription">
          <h2 id="manage-subscription">Manage subscription</h2>
          <p>Open the billing portal to manage this workspace’s subscription.</p>
          <form action={portalAction} className={styles.form}>
            <input name="attemptToken" type="hidden" value={randomUUID()} />
            <button type="submit" className={styles.secondary}>
              Open billing portal
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
