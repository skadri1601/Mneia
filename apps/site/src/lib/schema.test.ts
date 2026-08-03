import { describe, expect, test } from 'vitest';
import { docPage } from '@/content/docs';
import { ALL_FAQS } from '@/content/faq';
import {
  breadcrumbSchema,
  contactPageSchema,
  faqSchema,
  howToSchema,
  itemListSchema,
  organizationSchema,
  softwareApplicationSchema,
  techArticleSchema,
  websiteSchema,
} from './schema';

type Node = Record<string, unknown>;

describe('discoverability schemas', () => {
  test('publishes one consistent MNEIA organization identity', () => {
    const organization = organizationSchema();
    const website = websiteSchema();
    const software = softwareApplicationSchema();

    expect(organization.name).toBe('MNEIA');
    expect(organization.logo).toBe('https://mneia.dev/icon.svg');
    expect(website.name).toBe('MNEIA');
    expect(software.name).toBe('MNEIA');
    expect(software.description).toMatch(/shared project memory/i);
  });

  test('publishes the contactable addresses on the organization node', () => {
    const points = organizationSchema().contactPoint as readonly Node[];

    expect(points.map((point) => point.contactType)).toEqual(['privacy', 'security', 'legal']);
    expect(points.every((point) => String(point.email).endsWith('@mneia.dev'))).toBe(true);
  });

  test('walks the full ancestry for a nested docs route', () => {
    const trail = breadcrumbSchema('/docs/cli').itemListElement as readonly Node[];

    expect(trail.map((item) => item.name)).toEqual(['Home', 'Documentation', 'CLI reference']);
    expect(trail.map((item) => item.position)).toEqual([1, 2, 3]);
    expect(trail.at(-1)?.item).toBe('https://mneia.dev/docs/cli');
  });

  test('keeps a single-segment breadcrumb at two entries', () => {
    const trail = breadcrumbSchema('/faq').itemListElement as readonly Node[];

    expect(trail.map((item) => item.name)).toEqual(['Home', 'FAQ']);
  });

  test('answers every published question in one FAQPage node', () => {
    const questions = faqSchema(ALL_FAQS).mainEntity as readonly Node[];

    expect(questions.length).toBe(ALL_FAQS.length);
    expect(questions.length).toBeGreaterThan(20);
    expect(new Set(questions.map((question) => question.name)).size).toBe(questions.length);
  });

  test('marks the contact page as a ContactPage rather than a bare WebPage', () => {
    expect(contactPageSchema()['@type']).toBe('ContactPage');
    expect(contactPageSchema().url).toBe('https://mneia.dev/contact');
  });

  test('describes a doc page as a TechArticle carrying its section headings', () => {
    const page = docPage('cli');
    const article = techArticleSchema(page, '/docs/cli');

    expect(article['@type']).toBe('TechArticle');
    expect(article.articleSection).toEqual(page.sections.map((section) => section.heading));
    expect(article.timeRequired).toBe(`PT${page.minutes}M`);
  });

  test('emits HowTo steps only for the numbered quickstart', () => {
    const steps = howToSchema(docPage('quickstart'), '/docs/quickstart')?.step as readonly Node[];

    expect(steps.map((step) => step.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(steps[0]?.url).toBe('https://mneia.dev/docs/quickstart#install');
    expect(howToSchema(docPage('concepts'), '/docs/concepts')).toBeNull();
  });

  test('lists the docs index in reading order', () => {
    const list = itemListSchema('Mneia documentation', [
      '/docs/quickstart',
      '/docs/concepts',
      '/docs/cli',
      '/docs/mcp',
    ]);

    expect(list.numberOfItems).toBe(4);
    expect((list.itemListElement as readonly Node[])[0]?.name).toBe('Quickstart');
  });
});
