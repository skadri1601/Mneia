import type { DocPage } from '@/content/docs';
import { CONTACT } from '@/content/legal';
import type { Faq } from '@/content/pages';
import { TIERS } from '@/content/pages';
import {
  absoluteUrl,
  REPO_URL,
  ROUTES,
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
    contactPoint: [
      {
        '@type': 'ContactPoint',
        contactType: 'privacy',
        email: CONTACT.privacy,
        url: absoluteUrl('/contact'),
        availableLanguage: 'en',
      },
      {
        '@type': 'ContactPoint',
        contactType: 'security',
        email: CONTACT.security,
        url: absoluteUrl('/contact'),
        availableLanguage: 'en',
      },
      {
        '@type': 'ContactPoint',
        contactType: 'legal',
        email: CONTACT.legal,
        url: absoluteUrl('/contact'),
        availableLanguage: 'en',
      },
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

function ancestorPaths(path: RoutePath): readonly RoutePath[] {
  const segments = path.split('/').filter((segment) => segment.length > 0);

  return segments
    .map((_, index) => `/${segments.slice(0, index + 1).join('/')}`)
    .filter((candidate): candidate is RoutePath =>
      ROUTES.some((route) => route.path === candidate),
    );
}

export function breadcrumbSchema(path: RoutePath): JsonLdNode {
  const items = [{ name: 'Home', url: absoluteUrl('/') }];

  for (const ancestor of ancestorPaths(path)) {
    const route = routeFor(ancestor);
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

export function contactPageSchema(): JsonLdNode {
  const route = routeFor('/contact');
  return {
    '@type': 'ContactPage',
    '@id': `${absoluteUrl(route.path)}#webpage`,
    url: absoluteUrl(route.path),
    name: route.title,
    description: route.description,
    inLanguage: 'en',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': ORGANIZATION_ID },
  };
}

export function techArticleSchema(page: DocPage, path: RoutePath): JsonLdNode {
  return {
    '@type': 'TechArticle',
    '@id': `${absoluteUrl(path)}#article`,
    url: absoluteUrl(path),
    headline: page.heading,
    name: page.title,
    description: page.description,
    inLanguage: 'en',
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': SOFTWARE_ID },
    publisher: { '@id': ORGANIZATION_ID },
    articleSection: page.sections.map((section) => section.heading),
    timeRequired: `PT${page.minutes}M`,
    proficiencyLevel: 'Beginner',
  };
}

const NUMBERED_HEADING = /^(\d+)\.\s+(.*)$/;

export function howToSchema(page: DocPage, path: RoutePath): JsonLdNode | null {
  const steps = page.sections.flatMap((section) => {
    const match = NUMBERED_HEADING.exec(section.heading);
    return match?.[2] === undefined
      ? []
      : [
          {
            '@type': 'HowToStep',
            position: Number(match[1]),
            name: match[2],
            url: `${absoluteUrl(path)}#${section.id}`,
          },
        ];
  });

  if (steps.length === 0) {
    return null;
  }

  return {
    '@type': 'HowTo',
    '@id': `${absoluteUrl(path)}#howto`,
    name: page.title,
    description: page.description,
    inLanguage: 'en',
    totalTime: `PT${page.minutes}M`,
    step: steps,
  };
}

export function itemListSchema(name: string, paths: readonly RoutePath[]): JsonLdNode {
  return {
    '@type': 'ItemList',
    name,
    itemListOrder: 'https://schema.org/ItemListOrderAscending',
    numberOfItems: paths.length,
    itemListElement: paths.map((path, index) => {
      const route = routeFor(path);
      return {
        '@type': 'ListItem',
        position: index + 1,
        name: route.name,
        description: route.description,
        url: absoluteUrl(route.path),
      };
    }),
  };
}

export function graph(nodes: readonly JsonLdNode[]): JsonLdNode {
  return { '@context': 'https://schema.org', '@graph': nodes };
}
