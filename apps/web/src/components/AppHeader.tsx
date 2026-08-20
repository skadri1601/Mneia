import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { MARKETING_SITE_URL } from '../site.js';
import { AccountMenu } from './AccountMenu.js';
import styles from './AppHeader.module.css';
import { MneiaLetter } from './MneiaMark.js';
import { ProjectMenuToggle } from './project-workspace/ProjectMenuProvider.js';

const BRAND = (
  <>
    <MneiaLetter className={styles.mark} />
    <span>NEIA</span>
  </>
);

const DESTINATIONS = [
  { label: 'Docs', path: '/docs' },
  { label: 'Help', path: '/help' },
  { label: 'About', path: '/about' },
  { label: 'FAQ', path: '/faq' },
  { label: 'Contact', path: '/contact' },
  { label: 'Privacy', path: '/privacy' },
  { label: 'Terms', path: '/terms' },
];

export function AppHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <SignedIn>
          <div className={styles.identity}>
            <ProjectMenuToggle />
            <Link aria-label="MNEIA" className={styles.brand} href="/projects">
              {BRAND}
            </Link>
          </div>
        </SignedIn>
        <SignedOut>
          <a aria-label="MNEIA" className={styles.brand} href={MARKETING_SITE_URL}>
            {BRAND}
          </a>
        </SignedOut>
        <nav className={styles.nav} aria-label="Resources">
          <SignedIn>
            <Link href="/projects">Projects</Link>
            <Link href="/team">Team</Link>
            <Link href="/billing">Billing</Link>
          </SignedIn>
          {DESTINATIONS.map((destination) => (
            <a href={`${MARKETING_SITE_URL}${destination.path}`} key={destination.path}>
              {destination.label}
            </a>
          ))}
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
