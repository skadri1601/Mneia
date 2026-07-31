import type { ReactNode } from 'react';
import styles from './Card.module.css';

export function CardGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 }) {
  return <div className={`${styles.grid} ${columns === 2 ? styles.gridTwo : ''}`}>{children}</div>;
}

type CardProps = {
  index?: string;
  title: string;
  children: ReactNode;
  aside?: string;
  onRaised?: boolean;
};

export function Card({ index, title, children, aside, onRaised = false }: CardProps) {
  return (
    <article className={`${styles.card} ${onRaised ? styles.cardOnRaised : ''}`}>
      {index ? <div className={styles.index}>{index}</div> : null}
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.body}>{children}</div>
      {aside ? <p className={styles.aside}>{aside}</p> : null}
    </article>
  );
}
