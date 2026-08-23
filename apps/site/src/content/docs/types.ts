export type DocBlock =
  | { kind: 'text'; paragraphs: readonly string[] }
  | { kind: 'bullets'; items: readonly string[] }
  | { kind: 'steps'; items: readonly { title: string; body: string }[] }
  | { kind: 'code'; label: string; lines: readonly string[] }
  | { kind: 'table'; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: 'note'; text: string }
  | { kind: 'client-setup' };

export type DocSection = {
  id: string;
  heading: string;
  blocks: readonly DocBlock[];
};

export type DocSlug =
  | 'quickstart'
  | 'concepts'
  | 'glossary'
  | 'checkpoint'
  | 'rehydrate'
  | 'handoff'
  | 'conflicts'
  | 'scope'
  | 'cli'
  | 'mcp'
  | 'data-model'
  | 'integrations'
  | 'security';

export type DocPage = {
  slug: DocSlug;
  name: string;
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  lead: string;
  minutes: number;
  sections: readonly DocSection[];
};

export type DocsNavItem = { href: string; label: string };

export type DocsNavGroup = { heading: string; items: readonly DocsNavItem[] };
