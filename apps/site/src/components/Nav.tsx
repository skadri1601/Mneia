import Link from 'next/link';
import { ButtonPrimary } from './Button';
import styles from './Nav.module.css';

const ROUTES = [
  { href: '/handoff', label: 'Handoff' },
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/about', label: 'About' },
];

export function Nav() {
  return (
    <header className={styles.nav}>
      <nav className={styles.inner} aria-label="Primary">
        <Link className={styles.skip} href="#main">
          Skip to content
        </Link>
        <Link className={styles.wordmark} href="/">
          Mneia
        </Link>
        <ul className={styles.links}>
          {ROUTES.map((route) => (
            <li key={route.href}>
              <Link className={styles.link} href={route.href}>
                {route.label}
              </Link>
            </li>
          ))}
        </ul>
        <span className={styles.cta}>
          <ButtonPrimary href="/#waitlist">Request access</ButtonPrimary>
        </span>
      </nav>
    </header>
  );
}
