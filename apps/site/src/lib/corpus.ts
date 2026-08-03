import type { DocBlock, DocPage } from '@/content/docs';
import { DOC_PAGES, DOCS_INTRO, DOCS_STATUS } from '@/content/docs';
import { FAQ_GROUPS, FAQ_INTRO } from '@/content/faq';
import type { Block, Faq, Intro, Paragraph } from '@/content/pages';
import {
  ABOUT_AUDIENCE,
  ABOUT_BET,
  ABOUT_INTRO,
  ABOUT_LICENSING,
  ABOUT_SCOPE,
  ABOUT_THESIS,
  AUDIENCE,
  FEATURES,
  FEATURES_COMPOUND,
  FEATURES_COMPOUND_QUOTE,
  FEATURES_FAQ,
  FEATURES_INTRO,
  HANDOFF_INTRO,
  HANDOFF_SECTIONS,
  HANDOFF_SECTIONS_INTRO,
  HANDOFF_THESIS,
  HOME_ARTIFACT,
  HOME_INTRO,
  HOME_OPERATIONS_INTRO,
  HOME_PROBLEM,
  HOME_SURFACES,
  METERING,
  OPERATIONS,
  PRICING_FAQ,
  PRICING_INTRO,
  PRICING_METERING,
  PRICING_NO_KEY,
  PRICING_PREVIEW,
  paragraphText,
  THESIS_QUOTE,
  TIERS,
} from '@/content/pages';
import {
  CONTACT_ACCESS,
  CONTACT_CHANNELS,
  CONTACT_INTRO,
  CONTACT_NOT_YET,
  HELP_ESCALATION,
  HELP_INTRO,
  HELP_PATHS,
  HELP_SYMPTOMS,
  HELP_TASKS,
} from '@/content/support';
import { absoluteUrl, ROUTES, SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE } from './site';

function paragraphs(value: readonly Paragraph[]): string {
  return value.map(paragraphText).join('\n\n');
}

function section(intro: Intro): string {
  return `### ${intro.heading}\n\n${intro.lead}`;
}

function blockSection(block: Block): string {
  const heading = block.heading ? `### ${block.heading}` : `### ${block.eyebrow}`;
  return `${heading}\n\n${paragraphs(block.paragraphs)}`;
}

function faqSection(title: string, faqs: readonly Faq[]): string {
  const entries = faqs.map((faq) => `**${faq.question}**\n\n${faq.answer}`).join('\n\n');
  return `### ${title}\n\n${entries}`;
}

function page(path: string, title: string, parts: readonly string[]): string {
  return `## ${title}\n\nURL: ${absoluteUrl(path)}\n\n${parts.join('\n\n')}`;
}

function docBlock(block: DocBlock): string {
  if (block.kind === 'text') {
    return block.paragraphs.join('\n\n');
  }
  if (block.kind === 'bullets') {
    return block.items.map((item) => `- ${item}`).join('\n');
  }
  if (block.kind === 'steps') {
    return block.items.map((item, index) => `${index + 1}. ${item.title}: ${item.body}`).join('\n');
  }
  if (block.kind === 'code') {
    return `\`\`\`${block.label}\n${block.lines.join('\n')}\n\`\`\``;
  }
  if (block.kind === 'note') {
    return `Note: ${block.text}`;
  }
  return [
    `| ${block.head.join(' | ')} |`,
    `| ${block.head.map(() => '---').join(' | ')} |`,
    ...block.rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function docPageText(doc: DocPage): string {
  const body = doc.sections
    .map((section) => `#### ${section.heading}\n\n${section.blocks.map(docBlock).join('\n\n')}`)
    .join('\n\n');

  return page(`/docs/${doc.slug}`, doc.name, [`### ${doc.heading}\n\n${doc.lead}`, body]);
}

const HOME = page('/', 'Home', [
  section(HOME_INTRO),
  blockSection(HOME_PROBLEM),
  section(HOME_ARTIFACT),
  `### ${HOME_OPERATIONS_INTRO.heading}`,
  OPERATIONS.map(
    (operation) =>
      `${operation.index} ${operation.title}: ${operation.body}\nIn short: ${operation.aside}`,
  ).join('\n\n'),
  blockSection(HOME_SURFACES),
]);

const HANDOFF = page('/handoff', 'The handoff', [
  section(HANDOFF_INTRO),
  `### ${HANDOFF_SECTIONS_INTRO.heading}`,
  HANDOFF_SECTIONS.map((entry) => `${entry.index}, ${entry.title}: ${entry.body}`).join('\n\n'),
  `### The thesis\n\n"${THESIS_QUOTE}"\n\n${paragraphs(HANDOFF_THESIS.paragraphs)}`,
]);

const FEATURES_PAGE = page('/features', 'Features', [
  section(FEATURES_INTRO),
  FEATURES.map(
    (feature) =>
      `${feature.index} ${feature.title}: ${feature.body}\nToday, ${feature.todayValue}: ${feature.todayBody}`,
  ).join('\n\n'),
  `### ${FEATURES_COMPOUND.eyebrow}\n\n"${FEATURES_COMPOUND_QUOTE}"\n\n${paragraphs(
    FEATURES_COMPOUND.paragraphs,
  )}`,
  faqSection('Frequently asked questions', FEATURES_FAQ),
]);

const PRICING = page('/pricing', 'Pricing', [
  section(PRICING_INTRO),
  TIERS.map(
    (tier) =>
      `${tier.name}, ${tier.price}${tier.unit}: ${tier.note}\nIncludes: ${tier.contents.join(', ')}`,
  ).join('\n\n'),
  paragraphText(PRICING_PREVIEW),
  blockSection(PRICING_METERING),
  METERING.map((row) => `${row.action}. Marginal cost: ${row.cost}. ${row.metered}.`).join('\n'),
  blockSection(PRICING_NO_KEY),
  faqSection('Frequently asked questions', PRICING_FAQ),
]);

const ABOUT = page('/about', 'About', [
  section(ABOUT_INTRO),
  blockSection(ABOUT_BET),
  `### The thesis\n\n"${THESIS_QUOTE}"\n\n${paragraphs(ABOUT_THESIS.paragraphs)}`,
  blockSection(ABOUT_AUDIENCE),
  AUDIENCE.map((row) => `${row.who}: ${row.what}`).join('\n\n'),
  blockSection(ABOUT_LICENSING),
  blockSection(ABOUT_SCOPE),
]);

const FAQ = page('/faq', 'Frequently asked questions', [
  section(FAQ_INTRO),
  ...FAQ_GROUPS.map((group) => faqSection(`${group.heading} — ${group.blurb}`, group.items)),
]);

const HELP = page('/help', 'Help', [
  section(HELP_INTRO),
  `### Where to start\n\n${HELP_PATHS.map(
    (path) => `${path.title}: ${path.body} See ${absoluteUrl(path.href)}`,
  ).join('\n\n')}`,
  faqSection(
    'Common tasks',
    HELP_TASKS.map((task) => ({ question: task.question, answer: task.answer })),
  ),
  `### Troubleshooting\n\n${HELP_SYMPTOMS.map(
    (row) => `Symptom: ${row.symptom}\nWhy: ${row.cause}\nFix: ${row.fix}`,
  ).join('\n\n')}`,
  blockSection(HELP_ESCALATION),
]);

const CONTACT_PAGE = page('/contact', 'Contact', [
  section(CONTACT_INTRO),
  CONTACT_CHANNELS.map(
    (channel) => `${channel.label} — ${channel.address}\n${channel.what}\n${channel.note}`,
  ).join('\n\n'),
  blockSection(CONTACT_ACCESS),
  blockSection(CONTACT_NOT_YET),
]);

const DOCS_INDEX = page('/docs', 'Documentation', [
  section(DOCS_INTRO),
  DOCS_STATUS,
  DOC_PAGES.map(
    (doc) => `- [${doc.name}](${absoluteUrl(`/docs/${doc.slug}`)}): ${doc.description}`,
  ).join('\n'),
]);

const PREAMBLE = `# ${SITE_NAME}

> ${SITE_TAGLINE}

${SITE_DESCRIPTION}

MNEIA performs three operations. Checkpoint captures the decisions, constraints, and open questions out of an agent session at a task or day boundary. Rehydrate assembles the minimal high-signal context slice for the next task under a token budget. Handoff produces a receivable artifact when work changes hands.

It runs as an MCP server for Claude Code, Cursor, Codex, or any MCP client, as a CLI, and as a deliberately thin web app. The client packages are Apache 2.0. The hosted service is proprietary and required.`;

export function llmsTxt(): string {
  const index = ROUTES.map(
    (route) => `- [${route.name}](${absoluteUrl(route.path)}): ${route.description}`,
  ).join('\n');

  return `${PREAMBLE}

## Pages

${index}

## Optional

- [Full text of every page](${absoluteUrl('/llms-full.txt')}): the entire site as plain text, in one request.
`;
}

export function llmsFullTxt(): string {
  return `${PREAMBLE}

Everything below is the full text of every page on ${absoluteUrl('/')}, in one file.

${[
  HOME,
  HANDOFF,
  FEATURES_PAGE,
  PRICING,
  ABOUT,
  DOCS_INDEX,
  ...DOC_PAGES.map(docPageText),
  FAQ,
  HELP,
  CONTACT_PAGE,
].join('\n\n')}
`;
}
