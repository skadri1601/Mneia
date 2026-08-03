import type { ReactNode } from 'react';
import { DocsSidebar } from '@/components/DocsSidebar';
import styles from './layout.module.css';

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <div className={styles.grid}>
        <aside className={styles.rail}>
          <DocsSidebar />
        </aside>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
