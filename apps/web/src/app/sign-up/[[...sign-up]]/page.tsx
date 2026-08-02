import { SignUp } from '@clerk/nextjs';
import styles from '../../auth.module.css';

export default function SignUpPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="sign-up-title">
        <h1 id="sign-up-title">Create your Mneia account</h1>
        <SignUp forceRedirectUrl="/projects" path="/sign-up" routing="path" signInUrl="/sign-in" />
      </section>
    </main>
  );
}
