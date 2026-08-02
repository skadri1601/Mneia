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
  | '/terms'
  | '/privacy';

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
