import { SignIn } from '@clerk/nextjs';
import { MARKETING_SITE_URL } from '../../../site.js';
import styles from '../../auth.module.css';
import { AUTH_APPEARANCE } from '../../auth-appearance.js';

export default function SignInPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <SignIn
          appearance={AUTH_APPEARANCE}
          forceRedirectUrl="/projects"
          path="/sign-in"
          routing="path"
          signUpUrl="/sign-up"
        />
        <a className={styles.backLink} href={MARKETING_SITE_URL}>
          <span aria-hidden="true">←</span> Home
        </a>
      </section>
    </main>
  );
}
