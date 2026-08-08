import { SignUp } from '@clerk/nextjs';
import { MARKETING_SITE_URL } from '../../../site.js';
import styles from '../../auth.module.css';
import { AUTH_APPEARANCE } from '../../auth-appearance.js';

export default function SignUpPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="sign-up-title">
        <h1 className={styles.visuallyHidden} id="sign-up-title">
          Create your Mneia account
        </h1>
        <SignUp
          appearance={AUTH_APPEARANCE}
          forceRedirectUrl="/projects"
          path="/sign-up"
          routing="path"
          signInUrl="/sign-in"
        />
        <a className={styles.backLink} href={MARKETING_SITE_URL}>
          <span aria-hidden="true">←</span> Home
        </a>
      </section>
    </main>
  );
}
