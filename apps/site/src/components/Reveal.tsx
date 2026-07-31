import type { ReactNode } from 'react';
import styles from './Reveal.module.css';

const DELAYS = [styles.d0, styles.d1, styles.d2, styles.d3, styles.d4, styles.d5];

type Props = {
  children: ReactNode;
  className?: string | undefined;
};

export function Rise({
  children,
  step = 0,
  className = '',
}: Props & { step?: number | undefined }) {
  const delay = DELAYS[Math.min(step, DELAYS.length - 1)] ?? '';
  return <div className={`${styles.enter} ${delay} ${className}`}>{children}</div>;
}

export function RiseOnScroll({ children, className = '' }: Props & { late?: boolean | undefined }) {
  return <div className={`${styles.scrollUp} ${className}`}>{children}</div>;
}

export function SlideOnScroll({
  children,
  className = '',
  from = 'left',
}: Props & { from?: 'left' | 'right' | undefined }) {
  return (
    <div className={`${from === 'right' ? styles.scrollRight : styles.scrollLeft} ${className}`}>
      {children}
    </div>
  );
}
