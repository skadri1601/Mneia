import { SignIn } from '@clerk/nextjs';
import styles from '../../auth.module.css';

export default function SignInPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="sign-in-title">
        <h1 id="sign-in-title">Sign in to Mneia</h1>
        <SignIn forceRedirectUrl="/projects" path="/sign-in" routing="path" signUpUrl="/sign-up" />
      </section>
    </main>
  );
}
