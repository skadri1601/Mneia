import { ButtonSubmit } from './Button';
import styles from './WaitlistForm.module.css';

const ENDPOINT = process.env.NEXT_PUBLIC_WAITLIST_ENDPOINT;

export function WaitlistForm() {
  const live = Boolean(ENDPOINT);

  return (
    <form className={styles.form} action={ENDPOINT} method="post">
      <label className={styles.label} htmlFor="waitlist-email">
        Work email
      </label>
      <input
        className={styles.input}
        id="waitlist-email"
        type="email"
        name="email"
        placeholder="you@company.com"
        autoComplete="email"
        required
        disabled={!live}
      />
      <ButtonSubmit disabled={!live}>Request access</ButtonSubmit>
      <p className={styles.note}>
        {live
          ? 'One email when it opens up. Nothing else, and no sharing with anyone.'
          : 'The list is not open yet. Mneia is in private development and there is nothing to sign into — this form turns on when there is.'}
      </p>
    </form>
  );
}
