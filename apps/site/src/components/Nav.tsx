'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ButtonPrimary } from './Button';
import styles from './Nav.module.css';

const ROUTES = [
  { href: '/handoff', label: 'Handoff' },
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
];

const PAGE_NAMES: Record<string, string> = {
  '/': 'Mneia',
  '/handoff': 'Handoff',
  '/features': 'Features',
  '/pricing': 'Pricing',
  '/about': 'About',
};

export function Nav() {
  const pathname = usePathname();
  const pageName = PAGE_NAMES[pathname] ?? 'Mneia';

  return (
    <>
      <div className={styles.globalNav}>
        <nav className={styles.globalInner} aria-label="Primary">
          <Link className={styles.skip} href="#main">
            Skip to content
          </Link>
          <Link className={styles.wordmark} href="/">
            Mneia
          </Link>
          <ul className={styles.globalLinks}>
            {ROUTES.map((route) => (
              <li key={route.href}>
                <Link className={styles.globalLink} href={route.href}>
                  {route.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className={styles.subNav}>
        <div className={styles.subInner}>
          <span className={styles.subName}>{pageName}</span>
          <span className={styles.subCta}>
            <ButtonPrimary href="/#waitlist">Request access</ButtonPrimary>
          </span>
        </div>
      </div>
    </>
  );
}
