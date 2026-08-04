import styles from './AppFooter.module.css';

const SITE = 'https://mneia.dev';

export function AppFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <p className={styles.copyright}>© {new Date().getFullYear()} Mneia</p>
        <nav className={styles.links} aria-label="Legal">
          <a href={SITE}>mneia.dev</a>
          <a href={`${SITE}/privacy`}>Privacy</a>
          <a href={`${SITE}/terms`}>Terms</a>
          <a href={`${SITE}/help`}>Help</a>
        </nav>
      </div>
    </footer>
  );
}
