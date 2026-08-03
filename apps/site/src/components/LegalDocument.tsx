import { Fragment } from 'react';
import type { LegalBlock, LegalDoc } from '@/content/legal';
import { rich } from '@/content/pages';
import styles from './LegalDocument.module.css';

function Inline({ text }: { text: string }) {
  return (
    <>
      {rich(text).map((segment, index) =>
        segment.strong ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional within a fixed string
          <strong key={index}>{segment.text}</strong>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional within a fixed string
          <Fragment key={index}>{segment.text}</Fragment>
        ),
      )}
    </>
  );
}

function Block({ block }: { block: LegalBlock }) {
  if (block.kind === 'text') {
    return (
      <>
        {block.paragraphs.map((paragraph) => (
          <p className={styles.paragraph} key={paragraph}>
            <Inline text={paragraph} />
          </p>
        ))}
      </>
    );
  }

  if (block.kind === 'bullets') {
    return (
      <ul className={styles.bullets}>
        {block.items.map((item) => (
          <li key={item}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.kind === 'note') {
    return (
      <p className={styles.note}>
        <Inline text={block.text} />
      </p>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {block.head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join('|')}>
              {row.map((cell) => (
                <td key={cell}>
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LegalContents({ doc }: { doc: LegalDoc }) {
  return (
    <nav aria-label={`${doc.title} contents`} className={styles.contents}>
      {doc.sections.map((section) => (
        <a className={styles.contentsLink} href={`#${section.id}`} key={section.id}>
          {section.heading}
        </a>
      ))}
    </nav>
  );
}

export function LegalDates({ doc }: { doc: LegalDoc }) {
  return (
    <div className={styles.dates}>
      <span>Effective {doc.effective}</span>
      <span>Last updated {doc.updated}</span>
    </div>
  );
}

export function LegalBody({ doc }: { doc: LegalDoc }) {
  return (
    <>
      {doc.sections.map((section) => (
        <section className={styles.section} id={section.id} key={section.id}>
          <h2 className={styles.heading}>{section.heading}</h2>
          <div className={styles.blocks}>
            {section.blocks.map((block, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional within a fixed section
              <Block block={block} key={index} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function LegalReviewNotice({ text }: { text: string }) {
  return <p className={styles.review}>{text}</p>;
}
