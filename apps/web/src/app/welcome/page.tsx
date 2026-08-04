import Link from 'next/link';
import { getCurrentAccount } from '../../server/current-account.js';
import { COMPANY_SIZES, TEAM_FUNCTIONS } from '../../server/store/onboarding-store.js';
import { saveOnboardingAction } from './actions.js';
import styles from './welcome.module.css';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface WelcomePageProps {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}

const first = (value: string | readonly string[] | undefined): string | undefined =>
  typeof value === 'string' || value === undefined ? value : value[0];

const ERRORS: Readonly<Record<string, string>> = {
  invalid_company_name: 'Give your company or team a name of up to 200 characters.',
  invalid_display_name: 'Give your own name, up to 200 characters.',
  invalid_company_size: 'Choose one of the listed company sizes.',
  invalid_team_function: 'Choose one of the listed functions.',
};

const FUNCTION_LABELS: Readonly<Record<string, string>> = {
  engineering: 'Engineering',
  product: 'Product',
  design: 'Design',
  sales: 'Sales',
  marketing: 'Marketing',
  support: 'Support',
  success: 'Customer success',
  operations: 'Operations',
  finance: 'Finance',
  other: 'Something else',
};

export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  const [account, query] = await Promise.all([getCurrentAccount(), searchParams]);
  const error = ERRORS[first(query.error) ?? ''];

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p>Welcome to Mneia</p>
        <h1>Tell us where this is going</h1>
        <p>
          This names your workspace and helps us build for the teams actually using it. You can
          change any of it later, and you can skip it entirely.
        </p>
      </header>

      {error === undefined ? null : (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <form className={styles.form} action={saveOnboardingAction}>
        <div className={styles.field}>
          <label htmlFor="displayName">Your name</label>
          <input
            id="displayName"
            name="displayName"
            type="text"
            defaultValue={account.actor.displayName}
            maxLength={200}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="companyName">Company or team</label>
          <input
            id="companyName"
            name="companyName"
            type="text"
            defaultValue={account.workspace.displayName}
            maxLength={200}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="companySize">How many people work there?</label>
          <select id="companySize" name="companySize" defaultValue="">
            <option value="">Rather not say</option>
            {COMPANY_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label htmlFor="teamFunction">What does your team do?</label>
          <select id="teamFunction" name="teamFunction" defaultValue={account.team.function}>
            {TEAM_FUNCTIONS.map((value) => (
              <option key={value} value={value}>
                {FUNCTION_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.actions}>
          <button type="submit">Continue</button>
          <Link className={styles.skip} href="/projects">
            Skip for now
          </Link>
        </div>
      </form>
    </main>
  );
}
