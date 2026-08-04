import styles from './AppFooter.module.css';

const SITE = 'https://mneia.dev';

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.copyright}>© {new Date().getFullYear()} Mneia</p>
        <nav className={styles.links} aria-label="Support and legal">
          <a href={`${SITE}/docs`}>Docs</a>
          <a href={`${SITE}/help`}>Help</a>
          <a href={`${SITE}/contact`}>Contact</a>
          <a href={`${SITE}/privacy`}>Privacy</a>
          <a href={`${SITE}/terms`}>Terms</a>
        </nav>
      </div>
    </footer>
  );
}
