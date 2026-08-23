import { randomUUID } from 'node:crypto';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher.js';
import { canOpenPortal, canStartCheckout } from '../../server/billing/checkout.js';
import { billingStore } from '../../server/billing/runtime.js';
import { loadUsageReport } from '../../server/billing/usage-store.js';
import { getCurrentAccount } from '../../server/current-account.js';
import { checkoutAction, portalAction } from './actions.js';
import styles from './Billing.module.css';
import { UsageMeter } from './usage-meter.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface BillingPageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const title = (value: string): string => value.slice(0, 1).toUpperCase() + value.slice(1);

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const account = await getCurrentAccount();
  const [snapshot, usage, query] = await Promise.all([
    billingStore().snapshot(account.workspace.id),
    loadUsageReport(account.workspace.id),
    searchParams,
  ]);
  if (snapshot === null) {
    throw new Error('expected the authenticated workspace to have a billing snapshot; found none');
  }

  const billingAccount = {
    workspaceId: account.workspace.id,
    role: account.membership.role,
  } as const;
  const checkoutAvailable = canStartCheckout({ account: billingAccount, snapshot });
  const portalAvailable = canOpenPortal({ account: billingAccount, snapshot });
  const checkoutNotice = first(query.checkout);

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
            <dd>{snapshot.seatsPurchased ?? snapshot.memberCount}</dd>
          </div>
        </dl>
      </section>

      <UsageMeter report={usage} />

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
