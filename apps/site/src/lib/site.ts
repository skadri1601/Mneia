import type { Metadata } from 'next';

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://mneia.dev').replace(
  /\/+$/,
  '',
);

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.mneia.dev').replace(
  /\/+$/,
  '',
);

export const SIGN_IN_URL = `${APP_URL}/sign-in`;

export const SITE_NAME = 'MNEIA';

export const SITE_TITLE = 'MNEIA: shared memory and handoffs for AI-assisted teams';

export const SITE_TAGLINE =
  'The shared project memory and handoff layer for teams working with AI agents.';

export const SITE_DESCRIPTION =
  'MNEIA preserves shared project memory, decisions, constraints, and handoffs so AI-assisted teams can resume work with the right context.';

export const REPO_URL = 'https://github.com/skadri1601/Mneia';

export type RoutePath =
  | '/'
  | '/handoff'
  | '/features'
  | '/pricing'
  | '/about'
  | '/docs'
  | '/docs/quickstart'
  | '/docs/concepts'
  | '/docs/glossary'
  | '/docs/checkpoint'
  | '/docs/rehydrate'
  | '/docs/handoff'
  | '/docs/conflicts'
  | '/docs/scope'
  | '/docs/cli'
  | '/docs/mcp'
  | '/docs/data-model'
  | '/docs/integrations'
  | '/docs/security'
  | '/blog'
  | '/blog/the-unit-of-value-is-the-handoff'
  | '/blog/seven-days-of-dogfooding'
  | '/blog/the-watermark-that-skipped-600-turns'
  | '/faq'
  | '/help'
  | '/contact'
  | '/terms'
  | '/privacy'
  | '/cookies';

export type RouteEntry = {
  path: RoutePath;
  name: string;
  title: string;
  description: string;
  priority: number;
  changeFrequency: 'daily' | 'weekly' | 'monthly';
};

export const ROUTES: readonly RouteEntry[] = [
  {
    path: '/',
    name: 'Home',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    priority: 1,
    changeFrequency: 'weekly',
  },
  {
    path: '/handoff',
    name: 'The handoff',
    title: 'The handoff',
    description:
      'A real handoff artifact: what is done, current state, open questions, constraints, next action, with provenance on every line.',
    priority: 0.9,
    changeFrequency: 'monthly',
  },
  {
    path: '/features',
    name: 'Features',
    title: 'Features',
    description:
      'Five things that exist together nowhere else: the handoff artifact, human versus agent conflict resolution, provenance, and selective rehydration.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/pricing',
    name: 'Pricing',
    title: 'Pricing',
    description:
      'Solo is free and stays free. Teams pay per seat with an included checkpoint allowance. Enterprise is custom.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/about',
    name: 'About',
    title: 'About',
    description:
      'Why Mneia exists, who it is built for, and how it is licensed. The context layer is permanent, and nobody has built it for teams working with AI agents.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs',
    name: 'Documentation',
    title: 'Documentation',
    description:
      'How Mneia works and how to run it: the quickstart, the concepts, the three operations in depth, and the CLI, MCP, data model, and security references.',
    priority: 0.9,
    changeFrequency: 'weekly',
  },
  {
    path: '/docs/quickstart',
    name: 'Quickstart',
    title: 'Quickstart',
    description:
      'Install the Mneia CLI, authenticate, bind a repository to a project, connect an MCP client, and run your first checkpoint and rehydration.',
    priority: 0.8,
    changeFrequency: 'weekly',
  },
  {
    path: '/docs/concepts',
    name: 'Concepts',
    title: 'Concepts',
    description:
      'The three operations, the vocabulary Mneia uses for a context item, how provenance and superseding work, and why conflicts between a human and an agent are resolved the way they are.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/glossary',
    name: 'Glossary',
    title: 'Glossary',
    description:
      'Every term Mneia uses precisely, defined once: checkpoint, rehydrate, handoff, context item, load-bearing, human-confirmed, superseding, provenance, access scope, workspace, actor, and the rest.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/checkpoint',
    name: 'Checkpoint',
    title: 'Checkpoint',
    description:
      'How Mneia captures a session into project memory: triggers, extraction into the typed schema, deduplication, contradiction detection, the human confirmation queue, and the quality metric that governs the pipeline.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/rehydrate',
    name: 'Rehydrate',
    title: 'Rehydrate',
    description:
      'How Mneia assembles a context slice for a stated task: the scoring function, per-kind quotas, the guaranteed-inclusion pass for load-bearing constraints, the token budget, and the 300ms latency budget.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/handoff',
    name: 'Handoff',
    title: 'Handoff',
    description:
      'The handoff artifact: its sections, the superseded-recently block, freeze semantics and the live link, directed and open handoffs, and the measurement that proves it reduces pickup cost.',
    priority: 0.8,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/conflicts',
    name: 'Conflict resolution',
    title: 'Conflict resolution',
    description:
      'How Mneia arbitrates when two sources disagree: agent versus agent, agent versus a human-confirmed item, and human versus human — plus rationale capture and why the three rules are not symmetrical.',
    priority: 0.7,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/scope',
    name: 'Workspaces, teams, and scope',
    title: 'Workspaces, teams, and scope',
    description:
      'Identities and actors, workspaces, teams and their function, roles and invitations, the five-value visibility hierarchy, and how a question crosses from one team to another.',
    priority: 0.7,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/cli',
    name: 'CLI reference',
    title: 'CLI reference',
    description:
      'Every Mneia CLI command — init, login, whoami, brief, checkpoint, handoff, pickup, conflicts, log, and status — plus the interactive session, with flags, environment variables, JSON output, and exit codes.',
    priority: 0.7,
    changeFrequency: 'weekly',
  },
  {
    path: '/docs/mcp',
    name: 'MCP server reference',
    title: 'MCP server reference',
    description:
      'The Mneia MCP tools — mneia_rehydrate, mneia_assert, mneia_checkpoint, mneia_search, mneia_handoff_create, mneia_handoff_receive, and mneia_conflicts — how to configure the server, and when to call each one.',
    priority: 0.7,
    changeFrequency: 'weekly',
  },
  {
    path: '/docs/data-model',
    name: 'Data model',
    title: 'Data model',
    description:
      'The schema underneath Mneia: identities and actors, teams and projects, the context item with its provenance and bi-temporal columns, embeddings, checkpoints, handoffs, conflicts, and the event spine.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/integrations',
    name: 'Integrations',
    title: 'Integrations',
    description:
      'Where Mneia plugs in: MCP clients like Claude Code, Cursor, and Codex; file interop with AGENTS.md, CLAUDE.md, and .cursor/rules; the web app; CI runners; and what is deliberately not built.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/docs/security',
    name: 'Security and privacy',
    title: 'Security and privacy',
    description:
      'How Mneia isolates one workspace from another, how credentials and device approval work, what telemetry records and how to turn it off, retention and residency controls, audit export, and enterprise governance.',
    priority: 0.7,
    changeFrequency: 'monthly',
  },
  {
    path: '/blog',
    name: 'Blog',
    title: 'Blog',
    description:
      'Notes from building the shared memory and handoff layer: the arguments behind the product, and the bugs that taught us something worth writing down.',
    priority: 0.7,
    changeFrequency: 'weekly',
  },
  {
    path: '/blog/seven-days-of-dogfooding',
    name: 'Seven days of dogfooding our own memory layer',
    title: 'Seven days of dogfooding our own memory layer',
    description:
      'We wired five AI clients to our own project memory and ran the loop for a week. The interesting part was not whether it worked, but what had to be true before it could.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/blog/the-watermark-that-skipped-600-turns',
    name: 'The watermark that skipped 600 turns',
    title: 'The watermark that skipped 600 turns',
    description:
      'A transcript reducer, a progress marker, and an off-by-one-assumption that silently dropped half of every long session. The bug was in the gap between two correct components.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/blog/the-unit-of-value-is-the-handoff',
    name: 'The unit of value is not memory. It is the handoff.',
    title: 'The unit of value is not memory. It is the handoff.',
    description:
      'Every AI memory product gives you somewhere to put context and a way to query it. That is a database posture, and it fails at the exact moment it is needed — when someone is picking up work they did not do.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/faq',
    name: 'FAQ',
    title: 'Frequently asked questions',
    description:
      'What Mneia is, how it differs from an AI memory tool, what it costs, what happens to your data, and what is actually built today.',
    priority: 0.7,
    changeFrequency: 'monthly',
  },
  {
    path: '/help',
    name: 'Help',
    title: 'Help',
    description:
      'Common tasks, the errors people actually hit with the Mneia CLI and MCP server, and how to reach a person when the documentation does not cover it.',
    priority: 0.6,
    changeFrequency: 'monthly',
  },
  {
    path: '/contact',
    name: 'Contact',
    title: 'Contact',
    description:
      'How to reach Mneia: privacy and data rights, security reports, legal and licensing, and the DPDP grievance officer.',
    priority: 0.5,
    changeFrequency: 'monthly',
  },
  {
    path: '/terms',
    name: 'Terms of Service',
    title: 'Terms of Service',
    description:
      'The agreement between you and Mneia: what the Service is, who owns your content, how fees and metering work, and how disputes are resolved.',
    priority: 0.3,
    changeFrequency: 'monthly',
  },
  {
    path: '/privacy',
    name: 'Privacy Policy',
    title: 'Privacy Policy',
    description:
      'What we collect, why, who else touches it, and your rights under GDPR, the CCPA and other US state laws, and India’s DPDP Act. We do not train models on your content.',
    priority: 0.3,
    changeFrequency: 'monthly',
  },
  {
    path: '/cookies',
    name: 'Cookie Policy',
    title: 'Cookie Policy',
    description:
      'Every cookie mneia.dev sets, what it is for, how long it lasts, and how to refuse it. Analytics and advertising are separate choices, and Global Privacy Control is honoured everywhere.',
    priority: 0.3,
    changeFrequency: 'monthly',
  },
];

export function absoluteUrl(path: string): string {
  return path === '/' ? SITE_URL : `${SITE_URL}${path}`;
}

export function routeFor(path: RoutePath): RouteEntry {
  const entry = ROUTES.find((route) => route.path === path);
  if (!entry) {
    throw new Error(`expected ${path} to be registered in ROUTES; found none`);
  }
  return entry;
}

export function pageMetadata(path: RoutePath): Metadata {
  const route = routeFor(path);
  const url = absoluteUrl(route.path);
  const socialTitle = path === '/' ? SITE_TITLE : `${route.title} | ${SITE_NAME}`;

  return {
    title: path === '/' ? { absolute: route.title } : route.title,
    description: route.description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: 'en_US',
      url,
      title: socialTitle,
      description: route.description,
    },
    twitter: {
      card: 'summary_large_image',
      title: socialTitle,
      description: route.description,
    },
  };
}
