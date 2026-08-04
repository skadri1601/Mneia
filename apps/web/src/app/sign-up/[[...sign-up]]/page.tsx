import { SignUp } from '@clerk/nextjs';
import { MARKETING_SITE_URL } from '../../../site.js';
import styles from '../../auth.module.css';

export default function SignUpPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="sign-up-title">
        <a className={styles.backLink} href={MARKETING_SITE_URL}>
          <span aria-hidden="true">←</span> Back to mneia.dev
        </a>
        <h1 id="sign-up-title">Create your Mneia account</h1>
        <SignUp forceRedirectUrl="/projects" path="/sign-up" routing="path" signInUrl="/sign-in" />
      </section>
    </main>
  );
}
