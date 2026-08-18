import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { DOC_PAGES, DOCS_CARDS, DOCS_HERO_SAMPLE, DOCS_INTRO, DOCS_STATUS } from '@/content/docs';
import { breadcrumbSchema, itemListSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata, type RoutePath } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/docs');

const DOC_ROUTES: readonly RoutePath[] = DOC_PAGES.map((page) => `/docs/${page.slug}` as RoutePath);

export default function DocsPage() {
  return (
    <>
      <JsonLd
        nodes={[
          webPageSchema('/docs'),
          breadcrumbSchema('/docs'),
          itemListSchema('Mneia documentation', DOC_ROUTES),
        ]}
      />

      <div className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>{DOCS_INTRO.eyebrow}</p>
          <h1 className={styles.title}>{DOCS_INTRO.heading}</h1>
          <p className={styles.lead}>{DOCS_INTRO.lead}</p>
          <div className={styles.actions}>
            <Link className={styles.actionPrimary} href="/docs/quickstart">
              Get started
            </Link>
            <Link className={styles.actionSecondary} href="/docs/concepts">
              Read the concepts
            </Link>
          </div>
        </div>
        <div className={styles.sample}>
          <span className={styles.sampleLabel}>{DOCS_HERO_SAMPLE.label}</span>
          <pre className={styles.sampleCode}>
            <code>{DOCS_HERO_SAMPLE.lines.join('\n')}</code>
          </pre>
        </div>
      </div>

      <p className={styles.status}>{DOCS_STATUS}</p>

      <h2 className={styles.sectionHeading}>Start here</h2>
      <ul className={styles.cards}>
        {DOCS_CARDS.map((card) => {
          const page = DOC_PAGES.find((entry) => `/docs/${entry.slug}` === card.href);
          return (
            <li key={card.href}>
              <Link className={styles.card} href={card.href}>
                <span className={styles.cardTitle}>{card.title}</span>
                <span className={styles.cardBody}>{card.body}</span>
                {page ? <span className={styles.cardMeta}>{page.minutes} min read</span> : null}
              </Link>
            </li>
          );
        })}
      </ul>

      <h2 className={styles.sectionHeading}>The three operations</h2>
      <p className={styles.paragraph}>
        Everything in these pages serves one of three operations.{' '}
        <Link className={styles.inlineLink} href="/docs/checkpoint">
          Checkpoint
        </Link>{' '}
        captures the decisions, constraints, and open questions out of a session at a task or day
        boundary.{' '}
        <Link className={styles.inlineLink} href="/docs/rehydrate">
          Rehydrate
        </Link>{' '}
        assembles the minimal high-signal slice for the next task under a token budget.{' '}
        <Link className={styles.inlineLink} href="/docs/handoff">
          Handoff
        </Link>{' '}
        produces a receivable artifact when work changes hands.
      </p>
      <p className={styles.paragraph}>
        Where two of them collide,{' '}
        <Link className={styles.inlineLink} href="/docs/conflicts">
          conflict resolution
        </Link>{' '}
        decides what happens — and only one of its three rules is automatic. Every surface is a
        translation of the same verbs, so the CLI, an MCP client, the web app, and a CI runner
        return the same answer for the same input.
      </p>
    </>
  );
}
