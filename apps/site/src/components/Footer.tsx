import Link from 'next/link';
import styles from './Footer.module.css';
import { MneiaLetter } from './MneiaMark';

const COLUMNS = [
  {
    heading: 'Product',
    links: [
      { href: '/handoff', label: 'The handoff' },
      { href: '/features', label: 'Features' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/about#licensing', label: 'Licensing' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/terms', label: 'Terms of Service' },
      { href: '/privacy', label: 'Privacy Policy' },
    ],
  },
];

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div className={styles.wordmark}>
            <MneiaLetter className={styles.mark} />
            NEIA
          </div>
          <p className={styles.tagline}>
            The shared project memory and handoff layer for teams working with AI agents.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <div className={styles.column} key={column.heading}>
            <h2 className={styles.heading}>{column.heading}</h2>
            <ul className={styles.list}>
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link className={styles.link} href={link.href}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className={styles.legal}>
        <p>© {new Date().getFullYear()} Mneia. All rights reserved.</p>
      </div>
    </footer>
  );
}
