import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { MARKETING_SITE_URL } from '../site.js';
import { AccountMenu } from './AccountMenu.js';
import styles from './AppHeader.module.css';
import { MneiaLetter } from './MneiaMark.js';

const BRAND = (
  <>
    <MneiaLetter className={styles.mark} />
    <span className={styles.wordmark}>Mneia</span>
  </>
);

export function AppHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <SignedIn>
          <Link className={styles.brand} href="/projects">
            {BRAND}
          </Link>
        </SignedIn>
        <SignedOut>
          <a className={styles.brand} href={MARKETING_SITE_URL}>
            {BRAND}
          </a>
        </SignedOut>
        <nav className={styles.nav} aria-label="Resources">
          <a href={`${MARKETING_SITE_URL}/docs`}>Docs</a>
          <a href={`${MARKETING_SITE_URL}/help`}>Help</a>
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
