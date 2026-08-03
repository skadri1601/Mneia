'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DOCS_NAV } from '@/content/docs';
import styles from './DocsSidebar.module.css';

export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation" className={styles.sidebar}>
      {DOCS_NAV.map((group) => (
        <div className={styles.group} key={group.heading}>
          <h2 className={styles.heading}>{group.heading}</h2>
          <ul className={styles.list}>
            {group.items.map((item) => {
              const current = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    aria-current={current ? 'page' : undefined}
                    className={`${styles.link} ${current ? styles.linkCurrent : ''}`}
                    href={item.href}
                  >
                    <span>{item.label}</span>
                    {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
