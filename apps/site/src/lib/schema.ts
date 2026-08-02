import type { Faq } from '@/content/pages';
import { TIERS } from '@/content/pages';
import {
  absoluteUrl,
  REPO_URL,
  type RoutePath,
  routeFor,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_URL,
} from './site';

export type JsonLdNode = Record<string, unknown>;

const ORGANIZATION_ID = `${SITE_URL}/#organization`;
const WEBSITE_ID = `${SITE_URL}/#website`;
const SOFTWARE_ID = `${SITE_URL}/#software`;

export function organizationSchema(): JsonLdNode {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_TAGLINE,
    logo: absoluteUrl('/icon.svg'),
    sameAs: [REPO_URL],
    knowsAbout: [
      'Project memory',
      'AI-assisted software teams',
      'Agent handoffs',
      'Context rehydration',
    ],
  };
}

export function websiteSchema(): JsonLdNode {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    inLanguage: 'en',
    publisher: { '@id': ORGANIZATION_ID },
  };
}

export function softwareApplicationSchema(): JsonLdNode {
  const priced = TIERS.filter((tier) => tier.amount !== null);

  return {
    '@type': 'SoftwareApplication',
    '@id': SOFTWARE_ID,
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_TAGLINE,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Project memory and handoff for AI coding agents',
    operatingSystem: 'macOS, Linux, Windows',
    softwareRequirements: 'An MCP client such as Claude Code, Cursor, or Codex, or the Mneia CLI',
    publisher: { '@id': ORGANIZATION_ID },
    featureList: [
      'Handoff artifacts with provenance on every line',
      'Conflict resolution across humans and agents',
      'Selective rehydration under a token budget',
      'Boundary-triggered structured checkpoints',
      'MCP server and CLI',
    ],
    offers: priced.map((tier) => ({
      '@type': 'Offer',
      name: tier.name,
      price: String(tier.amount),
      priceCurrency: 'USD',
      description: tier.note,
      url: absoluteUrl('/pricing'),
    })),
  };
}

export function faqSchema(faqs: readonly Faq[]): JsonLdNode {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

export function breadcrumbSchema(path: RoutePath): JsonLdNode {
  const route = routeFor(path);
  const items = [{ name: 'Home', url: absoluteUrl('/') }];
  if (path !== '/') {
    items.push({ name: route.name, url: absoluteUrl(route.path) });
  }

  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function webPageSchema(path: RoutePath): JsonLdNode {
  const route = routeFor(path);
  return {
    '@type': 'WebPage',
    '@id': `${absoluteUrl(route.path)}#webpage`,
    url: absoluteUrl(route.path),
    name: route.title,
    description: route.description,
    inLanguage: 'en',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': SOFTWARE_ID },
  };
}

export function graph(nodes: readonly JsonLdNode[]): JsonLdNode {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
