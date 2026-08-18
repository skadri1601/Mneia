import type { ReactNode } from 'react';
import styles from './layout.module.css';

export default function BlogLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
