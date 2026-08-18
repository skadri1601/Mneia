import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DocSectionList } from '@/components/DocBody';
import { JsonLd } from '@/components/JsonLd';
import { type BlogPost, BLOG_POSTS, type BlogSlug, formatPublished } from '@/content/blog';
import { blogPostingSchema, breadcrumbSchema, type JsonLdNode, webPageSchema } from '@/lib/schema';
import { pageMetadata, type RoutePath } from '@/lib/site';
import styles from './page.module.css';

type Params = { slug: string };

const ROUTE_BY_SLUG: Readonly<Record<BlogSlug, RoutePath>> = {
  'the-unit-of-value-is-the-handoff': '/blog/the-unit-of-value-is-the-handoff',
  'seven-days-of-dogfooding': '/blog/seven-days-of-dogfooding',
  'the-watermark-that-skipped-600-turns': '/blog/the-watermark-that-skipped-600-turns',
};

function findPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

export function generateStaticParams(): Params[] {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = findPost(slug);
  return post ? pageMetadata(ROUTE_BY_SLUG[post.slug]) : {};
}

export default async function BlogPostRoute({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const post = findPost(slug);

  if (!post) {
    notFound();
  }

  const path = ROUTE_BY_SLUG[post.slug];
  const index = BLOG_POSTS.findIndex((entry) => entry.slug === post.slug);
  const next =
    BLOG_POSTS.find((_, position) => position > index) ??
    BLOG_POSTS.find((entry) => entry.slug !== post.slug);

  const nodes: JsonLdNode[] = [
    webPageSchema(path),
    breadcrumbSchema(path),
    blogPostingSchema(post, path),
  ];

  return (
    <>
      <JsonLd nodes={nodes} />

      <div className={styles.columns}>
        <article className={styles.article}>
          <nav aria-label="Breadcrumb" className={styles.crumbs}>
            <Link className={styles.crumb} href="/blog">
              Blog
            </Link>
            <span aria-hidden="true">/</span>
            <span className={styles.crumbCurrent}>{post.eyebrow}</span>
          </nav>

          <h1 className={styles.title}>{post.heading}</h1>
          <p className={styles.lead}>{post.lead}</p>

          <div className={styles.byline}>
            <span className={styles.author}>{post.author}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={post.published}>{formatPublished(post.published)}</time>
            <span aria-hidden="true">·</span>
            <span>{post.minutes} min read</span>
          </div>

          <ul className={styles.tags}>
            {post.tags.map((tag) => (
              <li className={styles.tag} key={tag}>
                {tag}
              </li>
            ))}
          </ul>

          <DocSectionList sections={post.sections} />

          {next ? (
            <nav aria-label="More posts" className={styles.pager}>
              <Link className={styles.pagerLink} href={`/blog/${next.slug}`}>
                <span className={styles.pagerLabel}>Read next</span>
                <span className={styles.pagerName}>{next.title}</span>
              </Link>
            </nav>
          ) : null}
        </article>

        <aside className={styles.toc}>
          <p className={styles.tocHeading}>On this page</p>
          <ul className={styles.tocList}>
            {post.sections.map((section) => (
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
