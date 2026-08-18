import { Fragment } from 'react';
import type { DocBlock, DocPage, DocSection } from '@/content/docs';
import styles from './DocBody.module.css';

type InlineToken = { text: string; strong?: boolean; code?: boolean };

function tokenise(text: string): readonly InlineToken[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/)
    .filter((part) => part.length > 0)
    .map((part) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return { text: part.slice(2, -2), strong: true };
      }
      if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
        return { text: part.slice(1, -1), code: true };
      }
      return { text: part };
    });
}

export function DocInline({ text }: { text: string }) {
  return (
    <>
      {tokenise(text).map((token, index) => {
        if (token.strong) {
          // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a fixed string
          return <strong key={index}>{token.text}</strong>;
        }
        if (token.code) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a fixed string
            <code className={styles.inlineCode} key={index}>
              {token.text}
            </code>
          );
        }
        // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional within a fixed string
        return <Fragment key={index}>{token.text}</Fragment>;
      })}
    </>
  );
}

function Block({ block }: { block: DocBlock }) {
  if (block.kind === 'text') {
    return (
      <>
        {block.paragraphs.map((paragraph) => (
          <p className={styles.paragraph} key={paragraph}>
            <DocInline text={paragraph} />
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
            <DocInline text={item} />
          </li>
        ))}
      </ul>
    );
  }

  if (block.kind === 'steps') {
    return (
      <ol className={styles.steps}>
        {block.items.map((item) => (
          <li key={item.title}>
            <span className={styles.stepTitle}>{item.title}</span>
            <span className={styles.stepBody}>
              <DocInline text={item.body} />
            </span>
          </li>
        ))}
      </ol>
    );
  }

  if (block.kind === 'code') {
    return (
      <div className={styles.codeWrap}>
        <span className={styles.codeLabel}>{block.label}</span>
        <pre className={styles.code}>
          <code>{block.lines.join('\n')}</code>
        </pre>
      </div>
    );
  }

  if (block.kind === 'note') {
    return (
      <p className={styles.note}>
        <DocInline text={block.text} />
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
                  <DocInline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocSectionList({ sections }: { sections: readonly DocSection[] }) {
  return (
    <>
      {sections.map((section) => (
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

export function DocSections({ page }: { page: DocPage }) {
  return <DocSectionList sections={page.sections} />;
}
