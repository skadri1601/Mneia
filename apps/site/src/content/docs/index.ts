import type { Intro } from '../pages';
import { API } from './api';
import { CHECKPOINT } from './checkpoint';
import { CLI } from './cli';
import { CONCEPTS } from './concepts';
import { CONFLICTS } from './conflicts';
import { DATA_MODEL } from './data-model';
import { GLOSSARY_PAGE } from './glossary';
import { HANDOFF_DOC } from './handoff';
import { INTEGRATIONS } from './integrations';
import { MCP } from './mcp';
import { METERING } from './metering';
import { OAUTH } from './oauth';
import { QUICKSTART } from './quickstart';
import { REHYDRATE } from './rehydrate';
import { SCOPE } from './scope';
import { SECURITY } from './security';
import { WEB_APP } from './web-app';
import type { DocPage, DocSlug, DocsNavGroup } from './types';

export { GLOSSARY, glossaryTerm } from './glossary';
export type { GlossaryTerm } from './glossary';
export type {
  DocBlock,
  DocPage,
  DocSection,
  DocSlug,
  DocsNavGroup,
  DocsNavItem,
} from './types';

export const DOCS_NAV: readonly DocsNavGroup[] = [
  {
    heading: 'Start',
    items: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/quickstart', label: 'Quickstart' },
      { href: '/docs/concepts', label: 'Concepts' },
      { href: '/docs/glossary', label: 'Glossary' },
    ],
  },
  {
    heading: 'Operations',
    items: [
      { href: '/docs/checkpoint', label: 'Checkpoint' },
      { href: '/docs/rehydrate', label: 'Rehydrate' },
      { href: '/docs/handoff', label: 'Handoff' },
      { href: '/docs/conflicts', label: 'Conflict resolution' },
    ],
  },
  {
    heading: 'Organisation',
    items: [
      { href: '/docs/scope', label: 'Workspaces, teams, and scope' },
      { href: '/docs/web-app', label: 'The web app' },
      { href: '/docs/metering', label: 'Metering and allowances' },
    ],
  },
  {
    heading: 'Reference',
    items: [
      { href: '/docs/cli', label: 'CLI' },
      { href: '/docs/mcp', label: 'MCP server' },
      { href: '/docs/api', label: 'HTTP API' },
      { href: '/docs/oauth', label: 'OAuth for remote MCP' },
      { href: '/docs/data-model', label: 'Data model' },
      { href: '/docs/integrations', label: 'Integrations' },
    ],
  },
  {
    heading: 'Trust',
    items: [{ href: '/docs/security', label: 'Security and privacy' }],
  },
  {
    heading: 'Support',
    items: [
      { href: '/faq', label: 'FAQ' },
      { href: '/help', label: 'Help' },
      { href: '/contact', label: 'Contact' },
    ],
  },
];

export const DOCS_HERO_SAMPLE = {
  label: 'session.sh',
  lines: [
    '$ mneia brief "migrate the ledger writes to v2"',
    '',
    '# Context slice: migrate the ledger writes to v2',
    'Generated 2026-08-17 09:14 UTC · 3 items · 412/4000 tokens',
    'Cite an item as `#id` when you use it.',
    '',
    '## Constraints (do not violate)',
    '- **LOAD-BEARING** [#4c1f7a2e · 2026-08-11 · human-confirmed] The cutover must be online',
    '- **LOAD-BEARING** [#9b3d0155 · 2026-08-12 · human-confirmed] Writes stay idempotent under retry',
    '',
    '## Superseded recently (do not re-propose)',
    '- [#e7a4b019 · 2026-08-14 · unconfirmed · superseded] Read from the shadow table in the worker',
    '  Replaced by reading from v2 directly.',
    '',
    '---',
    'task: migrate the ledger writes to v2',
    'items: 3 (2 load-bearing) · tokens: 412/4000 · generated: 2026-08-17T09:14:22.104Z',
  ],
} as const;

export const DOCS_CARDS = [
  {
    href: '/docs/quickstart',
    title: 'Quickstart',
    body: 'Install, authenticate, bind a repository, connect an MCP client, and run the loop end to end.',
  },
  {
    href: '/docs/concepts',
    title: 'Concepts',
    body: 'Item kinds, provenance, superseding, the two clocks, and how a rehydration slice is actually chosen.',
  },
  {
    href: '/docs/checkpoint',
    title: 'The three operations',
    body: 'Checkpoint, rehydrate, and handoff in depth - the pipeline, the scoring, and the artifact.',
  },
  {
    href: '/docs/cli',
    title: 'Reference',
    body: 'Every command, tool, flag, and exit code, plus the schema and the security posture underneath.',
  },
] as const;

export const DOCS_INTRO: Intro = {
  eyebrow: 'Documentation',
  heading: 'How Mneia works, and how to run it.',
  lead: 'Start with the quickstart to get running, and with concepts if you are still deciding. The operations pages are the product in depth; the reference pages are for when you need the exact flag.',
};

export const DOCS_STATUS =
  'Everything here describes one system: three operations - checkpoint, rehydrate, handoff - with conflict arbitration where they collide, reachable through the CLI, an MCP server, the web app, and a CI runner. The pages are organised by what you are trying to do rather than by which surface you reach it from, because the surfaces are translations of the same verbs and return the same answers for the same input.';

export const DOC_PAGES: readonly DocPage[] = [
  QUICKSTART,
  CONCEPTS,
  GLOSSARY_PAGE,
  CHECKPOINT,
  REHYDRATE,
  HANDOFF_DOC,
  CONFLICTS,
  SCOPE,
  WEB_APP,
  METERING,
  CLI,
  MCP,
  API,
  OAUTH,
  DATA_MODEL,
  INTEGRATIONS,
  SECURITY,
];

export function docPage(slug: DocSlug): DocPage {
  const page = DOC_PAGES.find((entry) => entry.slug === slug);
  if (!page) {
    throw new Error(`expected a doc page for "${slug}"; found none`);
  }
  return page;
}
