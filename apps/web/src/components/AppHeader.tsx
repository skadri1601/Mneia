import { SignedIn } from '@clerk/nextjs';
import Link from 'next/link';
import { AccountMenu } from './AccountMenu.js';
import styles from './AppHeader.module.css';
import { MneiaLetter } from './MneiaMark.js';

const SITE = 'https://mneia.dev';

export function AppHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link className={styles.brand} href="/projects">
          <MneiaLetter className={styles.mark} />
          <span className={styles.wordmark}>Mneia</span>
        </Link>
        <nav className={styles.nav} aria-label="Resources">
          <a href={`${SITE}/docs`}>Docs</a>
          <a href={`${SITE}/help`}>Help</a>
        </nav>
        <SignedIn>
          <div className={styles.account}>
            <AccountMenu />
          </div>
        </SignedIn>
      </div>
    </header>
  );
}
