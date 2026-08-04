import { SignedIn, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import styles from './AppHeader.module.css';
import { MneiaLetter } from './MneiaMark.js';

export function AppHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/projects">
          <MneiaLetter className={styles.mark} />
          <span className={styles.wordmark}>Mneia</span>
        </Link>
        <SignedIn>
          <div className={styles.account}>
            <UserButton
              appearance={{ elements: { avatarBox: { width: '32px', height: '32px' } } }}
            />
          </div>
        </SignedIn>
      </div>
    </header>
  );
}
