import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { DOC_PAGES, DOCS_CARDS, DOCS_HERO_SAMPLE, DOCS_INTRO, DOCS_STATUS } from '@/content/docs';
import { breadcrumbSchema, itemListSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata, type RoutePath } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/docs');

const DOC_ROUTES: readonly RoutePath[] = [
  '/docs/quickstart',
  '/docs/concepts',
  '/docs/cli',
  '/docs/mcp',
];

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
        Everything in these pages serves one of three operations. <strong>Checkpoint</strong>{' '}
        captures the decisions, constraints, and open questions out of a session at a task or day
        boundary. <strong>Rehydrate</strong> assembles the minimal high-signal slice for the next
        task under a token budget. <strong>Handoff</strong> produces a receivable artifact when work
        changes hands.
      </p>
      <p className={styles.paragraph}>
        Checkpoint and rehydrate are available now. Handoff ships in the next milestone, and both
        clients refuse that surface by name today rather than pretending it exists — see{' '}
        <Link className={styles.inlineLink} href="/handoff">
          the handoff artifact
        </Link>{' '}
        for what it will contain.
      </p>
    </>
  );
}
