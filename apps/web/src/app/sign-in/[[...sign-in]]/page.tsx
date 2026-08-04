import { SignIn } from '@clerk/nextjs';
import { MARKETING_SITE_URL } from '../../../site.js';
import styles from '../../auth.module.css';

export default function SignInPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <a className={styles.backLink} href={MARKETING_SITE_URL}>
          <span aria-hidden="true">←</span> Back to mneia.dev
        </a>
        <SignIn forceRedirectUrl="/projects" path="/sign-in" routing="path" signUpUrl="/sign-up" />
      </section>
    </main>
  );
}
