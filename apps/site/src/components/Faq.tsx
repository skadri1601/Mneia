import type { Faq as FaqEntry } from '@/content/pages';
import styles from './Faq.module.css';

export function FaqList({ items }: { items: readonly FaqEntry[] }) {
  return (
    <dl className={styles.list}>
      {items.map((item) => (
        <div className={styles.item} key={item.question}>
          <dt className={styles.question}>{item.question}</dt>
          <dd className={styles.answer}>{item.answer}</dd>
        </div>
      ))}
    </dl>
  );
}
