import { SignIn } from '@clerk/nextjs';
import styles from '../../auth.module.css';

export default function SignInPage() {
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <SignIn forceRedirectUrl="/projects" path="/sign-in" routing="path" signUpUrl="/sign-up" />
      </section>
    </main>
  );
}
