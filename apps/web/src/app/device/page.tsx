import { getCurrentAccount } from '../../server/current-account.js';
import { normalizeUserCode } from '../../server/device-codes.js';
import { deviceStore } from '../../server/device-runtime.js';
import { decideDeviceAction } from './actions.js';
import styles from './device.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface DevicePageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const ERRORS: Readonly<Record<string, string>> = {
  invalid_user_code: 'That does not look like a sign-in code. Check the code in your terminal.',
  invalid_confirmation_code: 'The confirmation number is the four digits shown in your terminal.',
  unknown_user_code:
    'That code is not waiting for approval — it may have expired, or already been used. Run mneia login again.',
  already_decided: 'That sign-in request was already approved or denied. Run mneia login again.',
  confirmation_mismatch: 'That number does not match the one shown in your terminal.',
  too_many_attempts:
    'Too many incorrect confirmation numbers. Wait fifteen minutes, then run mneia login again.',
};

export default async function DevicePage({ searchParams }: DevicePageProps) {
  const [account, query] = await Promise.all([getCurrentAccount(), searchParams]);

  const outcome = first(query.outcome);
  const error = ERRORS[first(query.error) ?? ''];
  const requestedCode = normalizeUserCode(first(query.user_code) ?? '');
  const pending =
    requestedCode.length === 0 ? null : await deviceStore.findPendingByUserCode(requestedCode);

  if (outcome === 'approved' || outcome === 'denied') {
    return (
      <main className={styles.page}>
        <header className={styles.pageHeader}>
          <p>Command line sign-in</p>
          <h1>{outcome === 'approved' ? 'Approved' : 'Denied'}</h1>
          <p>
            {outcome === 'approved'
              ? `That terminal is now signed in to ${first(query.workspace) ?? account.workspace.displayName}. You can close this page.`
              : 'Nothing was signed in. You can close this page.'}
          </p>
        </header>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>Command line sign-in</p>
        <h1>Approve this sign-in</h1>
        <p>
          You are signed in as {account.actor.displayName} in {account.workspace.displayName}.
          Approving signs the terminal below into <strong>this</strong> workspace.
        </p>
      </header>

      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form action={decideDeviceAction} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="userCode">Code from your terminal</label>
          <input
            autoComplete="off"
            defaultValue={requestedCode}
            id="userCode"
            inputMode="text"
            name="userCode"
            placeholder="BCDF-GHJK"
            required
            spellCheck={false}
          />
        </div>

        {pending === null ? null : (
          <p className={styles.client}>
            Requested by{' '}
            <strong>
              {pending.clientLabel === '' ? 'an unnamed client' : pending.clientLabel}
            </strong>
          </p>
        )}

        <div className={styles.field}>
          <label htmlFor="confirmationCode">Confirmation number shown in your terminal</label>
          <input
            autoComplete="off"
            id="confirmationCode"
            inputMode="numeric"
            maxLength={4}
            name="confirmationCode"
            pattern="[0-9]{4}"
            placeholder="0000"
            required
            spellCheck={false}
          />
        </div>

        <p className={styles.warning}>
          Only approve this if you started it. Anyone can send you a code — approving one you did
          not ask for signs <em>their</em> terminal into your workspace.
        </p>

        <div className={styles.actions}>
          <button className={styles.approve} name="decision" type="submit" value="approve">
            Approve
          </button>
          <button className={styles.deny} name="decision" type="submit" value="deny">
            Deny
          </button>
        </div>
      </form>
    </main>
  );
}
