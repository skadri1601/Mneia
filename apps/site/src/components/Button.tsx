import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './Button.module.css';

type LinkButtonProps = {
  href: string;
  children: ReactNode;
};

export function ButtonPrimary({ href, children }: LinkButtonProps) {
  return (
    <Link className={`${styles.base} ${styles.primary}`} href={href}>
      {children}
    </Link>
  );
}

export function ButtonGhost({ href, children }: LinkButtonProps) {
  return (
    <Link className={`${styles.base} ${styles.ghost}`} href={href}>
      {children}
    </Link>
  );
}

export function ButtonSubmit({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button className={`${styles.base} ${styles.primary}`} type="submit" disabled={disabled}>
      {children}
    </button>
  );
}
