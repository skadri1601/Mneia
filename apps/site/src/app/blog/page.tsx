import Link from 'next/link';
import { JsonLd } from '@/components/JsonLd';
import { BLOG_INTRO, BLOG_POSTS, BLOG_STATUS, formatPublished } from '@/content/blog';
import { blogSchema, breadcrumbSchema, webPageSchema } from '@/lib/schema';
import { pageMetadata } from '@/lib/site';
import styles from './page.module.css';

export const metadata = pageMetadata('/blog');

export default function BlogIndexPage() {
  const [lead, ...rest] = BLOG_POSTS;

  return (
    <>
      <JsonLd nodes={[webPageSchema('/blog'), breadcrumbSchema('/blog'), blogSchema(BLOG_POSTS)]} />

      <header className={styles.hero}>
        <p className={styles.eyebrow}>{BLOG_INTRO.eyebrow}</p>
        <h1 className={styles.title}>{BLOG_INTRO.heading}</h1>
        <p className={styles.lead}>{BLOG_INTRO.lead}</p>
      </header>

      {lead ? (
        <Link className={styles.feature} href={`/blog/${lead.slug}`}>
          <span className={styles.featureMeta}>
            <span className={styles.badge}>Latest</span>
            <time dateTime={lead.published}>{formatPublished(lead.published)}</time>
            <span aria-hidden="true">·</span>
            <span>{lead.minutes} min read</span>
          </span>
          <span className={styles.featureTitle}>{lead.title}</span>
          <span className={styles.featureBody}>{lead.description}</span>
          <span className={styles.featureCta}>Read the post</span>
        </Link>
      ) : null}

      {rest.length > 0 ? (
        <>
          <h2 className={styles.sectionHeading}>More posts</h2>
          <ul className={styles.list}>
            {rest.map((post) => (
              <li key={post.slug}>
                <Link className={styles.card} href={`/blog/${post.slug}`}>
                  <span className={styles.cardMeta}>
                    <span className={styles.eyebrowSmall}>{post.eyebrow}</span>
                    <time dateTime={post.published}>{formatPublished(post.published)}</time>
                    <span aria-hidden="true">·</span>
                    <span>{post.minutes} min read</span>
                  </span>
                  <span className={styles.cardTitle}>{post.title}</span>
                  <span className={styles.cardBody}>{post.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className={styles.status}>{BLOG_STATUS}</p>
    </>
  );
}
