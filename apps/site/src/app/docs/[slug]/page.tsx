import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocSections } from '@/components/DocBody';
import { JsonLd } from '@/components/JsonLd';
import { DOC_PAGES, type DocPage, type DocSlug } from '@/content/docs';
import {
  breadcrumbSchema,
  howToSchema,
  type JsonLdNode,
  techArticleSchema,
  webPageSchema,
} from '@/lib/schema';
import { pageMetadata, type RoutePath } from '@/lib/site';
import styles from './page.module.css';

type Params = { slug: string };

const ROUTE_BY_SLUG: Readonly<Record<DocSlug, RoutePath>> = {
  quickstart: '/docs/quickstart',
  concepts: '/docs/concepts',
  cli: '/docs/cli',
  mcp: '/docs/mcp',
};

function findPage(slug: string): DocPage | undefined {
  return DOC_PAGES.find((page) => page.slug === slug);
}

export function generateStaticParams(): Params[] {
  return DOC_PAGES.map((page) => ({ slug: page.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = findPage(slug);
  return page ? pageMetadata(ROUTE_BY_SLUG[page.slug]) : {};
}

export default async function DocPageRoute({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const page = findPage(slug);

  if (!page) {
    notFound();
  }

  const path = ROUTE_BY_SLUG[page.slug];
  const index = DOC_PAGES.findIndex((entry) => entry.slug === page.slug);
  const previous = index > 0 ? DOC_PAGES[index - 1] : undefined;
  const next = DOC_PAGES[index + 1];

  const nodes: JsonLdNode[] = [
    webPageSchema(path),
    breadcrumbSchema(path),
    techArticleSchema(page, path),
  ];
  const howTo = howToSchema(page, path);
  if (howTo) {
    nodes.push(howTo);
  }

  return (
    <>
      <JsonLd nodes={nodes} />

      <div className={styles.columns}>
        <article className={styles.article}>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <Link className={styles.crumb} href="/docs">
              Documentation
            </Link>
            <span aria-hidden="true">/</span>
            <span className={styles.crumbCurrent}>{page.name}</span>
          </nav>

          <h1 className={styles.title}>{page.heading}</h1>
          <p className={styles.lead}>{page.lead}</p>
          <p className={styles.meta}>
            {page.minutes} min read · {page.sections.length} sections
          </p>

          <DocSections page={page} />

          <nav aria-label="Pagination" className={styles.pager}>
            {previous ? (
              <Link className={styles.pagerLink} href={`/docs/${previous.slug}`}>
                <span className={styles.pagerLabel}>Previous</span>
                <span className={styles.pagerName}>{previous.name}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link
                className={`${styles.pagerLink} ${styles.pagerNext}`}
                href={`/docs/${next.slug}`}
              >
                <span className={styles.pagerLabel}>Next</span>
                <span className={styles.pagerName}>{next.name}</span>
              </Link>
            ) : (
              <Link className={`${styles.pagerLink} ${styles.pagerNext}`} href="/help">
                <span className={styles.pagerLabel}>Next</span>
                <span className={styles.pagerName}>Help</span>
              </Link>
            )}
          </nav>
        </article>

        <aside className={styles.toc}>
          <p className={styles.tocHeading}>On this page</p>
          <ul className={styles.tocList}>
            {page.sections.map((section) => (
              <li key={section.id}>
                <a className={styles.tocLink} href={`#${section.id}`}>
                  {section.heading}
                </a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
