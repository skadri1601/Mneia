import type { Faq, Intro } from './pages';
import { FEATURES_FAQ, PRICING_FAQ } from './pages';

export type FaqGroup = {
  id: string;
  heading: string;
  blurb: string;
  items: readonly Faq[];
};

export const FAQ_INTRO: Intro = {
  eyebrow: 'Questions',
  heading: 'Everything people ask, in one place.',
  lead: 'What Mneia is, how it differs from a memory tool, what it costs, what happens to your data, and what is actually built today.',
};

export const FAQ_GETTING_STARTED: readonly Faq[] = [
  {
    question: 'Is Mneia available yet?',
    answer:
      'Yes. Sign up at app.mneia.dev and install the clients from npm, then read the quickstart - it takes you from nothing to a rehydrated session in six steps. If a command is not in the build you have, the CLI names it rather than failing as an unknown command, so you can always tell that apart from a typo.',
  },
  {
    question: 'How do I get access?',
    answer:
      'Sign up at app.mneia.dev with a work email, or accept an invitation from a colleague. Accepting an invitation puts you in their workspace rather than a new one of your own, which matters - two people at the same company who each sign up cold land in separate workspaces and cannot see each other’s work.',
  },
  {
    question: 'What do I install?',
    answer:
      'Install both clients with npm install -g @mneia/cli @mneia/mcp-server. Run mneia login, mneia init, then mneia mcp install to detect and configure Codex, Claude Code, Claude Desktop, Cursor, Gemini CLI, VS Code, Windsurf, or another supported MCP client. The CLI drives the terminal surface; the MCP server exposes all eleven shipped tools so the agent can rehydrate, checkpoint, and hand work off without you relaying it. Node 20.11 or newer for both.',
  },
  {
    question: 'How do I get my team into the same workspace?',
    answer:
      'Invite them by email from the team page, and they land in your workspace when they accept. This is worth doing early rather than at the end. Mneia only does its actual job - carrying what one person decided to the next person who picks the work up - once there is more than one writer in a project. A workspace of one is a memory tool; a workspace of several is the product.',
  },
  {
    question: 'What does mneia init actually do to my repository?',
    answer:
      'Four things. It writes .mneia/config.json binding the directory to a workspace and a project. It reads the AGENTS.md, CLAUDE.md, and .cursor/rules files you already keep and imports the constraints it finds in them, so the project does not start empty. It writes a generated section into AGENTS.md, inside a fence it owns, so the agent sees the binding without you configuring anything twice. And it installs a session-start hook for Claude Code, Codex, and Cursor, so those agents load the project memory themselves when a session opens. Existing config in those files is merged, never replaced, and nothing outside the AGENTS.md fence is touched. Pass --no-hooks to skip that last step.',
  },
  {
    question: 'Do I have to change how I work?',
    answer:
      'Less than it used to be. Rehydration at session start is automatic - mneia init installs a hook that hands your agent the active constraints and decisions before it plans anything, so there is nothing to type and nothing to remember. What is left is checkpointing at the end of a task, which the agent can do itself through the MCP server, and the CLI exists for the moments you would rather do it yourself.',
  },
  {
    question: 'Does Mneia read my session transcript automatically?',
    answer:
      'No. mneia_checkpoint records a batch of candidate items that the agent extracted; it does not read the transcript itself. That is deliberate. Ambient capture produces noise, and capture at an explicit boundary produces something a human can review before it becomes project memory.',
  },
];

export const FAQ_DATA: readonly Faq[] = [
  {
    question: 'Do you train models on my content?',
    answer:
      'No. Your project content is not used to train models, ours or anyone else’s. The Privacy Policy states this as an obligation rather than an intention.',
  },
  {
    question: 'Can I self-host Mneia?',
    answer:
      'No. Mneia runs as a hosted service, and the CLI and MCP server require an account and do not function without it. We would rather say that plainly here than have you discover it after installing. Bring-your-own-cloud deployment is an Enterprise conversation, not a download.',
  },
  {
    question: 'Is Mneia open source?',
    answer:
      'Partly, and the line is drawn on purpose. The client packages are Apache 2.0: the CLI, the MCP server, and the core, which holds the schema definitions, the handoff format, the extraction prompts, and the ranking algorithm. The hosted API, the store, billing, and the review surfaces are proprietary.',
  },
  {
    question: 'Where is my data stored?',
    answer:
      'In managed Postgres in the United States. Every row carries the workspace it belongs to, and the database enforces workspace isolation with Postgres row-level security rather than relying on the application to remember. The Privacy Policy lists every subprocessor that touches your data and what each one does.',
  },
  {
    question: 'What telemetry does Mneia collect, and can I turn it off?',
    answer:
      'Mneia records structured product events - that a checkpoint ran, how large a rehydration slice was, whether an item was confirmed - because the quality of the extraction cannot be improved without measuring it. Your content is not in those events by default, and you can opt out entirely by setting MNEIA_TELEMETRY=off in the environment of the CLI or the MCP server.',
  },
  {
    question: 'What happens to my project memory if I stop paying or leave?',
    answer:
      'It is yours. The record of what your team decided and why is the thing that accumulates value, so it is exportable rather than hostage. The Terms set out the retention window and the export path.',
  },
];

export const FAQ_SUPPORT: readonly Faq[] = [
  {
    question: 'How do I report a security problem?',
    answer:
      'Email security@mneia.dev with enough detail to reproduce it. Please do not include anyone else’s data in the report. Mneia is a small team, so that address reaches a person directly rather than a queue.',
  },
  {
    question: 'How do I exercise a privacy right - access, correction, or deletion?',
    answer:
      'Email privacy@mneia.dev. Requests under the GDPR, the CCPA and other US state laws, and India’s DPDP Act are answered within the statutory window set out in the Privacy Policy. If you are on the waitlist and want off it, the unsubscribe link hard-deletes your address rather than flagging it.',
  },
  {
    question: 'Is there a support SLA?',
    answer:
      'Only on Enterprise, where it is a contracted term. We would rather say that than publish a number we cannot hold across every plan. Everything else gets a reply from a person as soon as we can manage it, which today is genuinely fast because the team is small.',
  },
];

export const FAQ_GROUPS: readonly FaqGroup[] = [
  {
    id: 'product',
    heading: 'The product',
    blurb: 'What Mneia is, and what it is not.',
    items: FEATURES_FAQ,
  },
  {
    id: 'getting-started',
    heading: 'Getting started',
    blurb: 'Access, install, and what changes about your day.',
    items: FAQ_GETTING_STARTED,
  },
  {
    id: 'pricing',
    heading: 'Pricing and billing',
    blurb: 'What is free, what is metered, and what is not.',
    items: PRICING_FAQ,
  },
  {
    id: 'data',
    heading: 'Data, privacy, and licensing',
    blurb: 'Where your content lives and who can reach it.',
    items: FAQ_DATA,
  },
  {
    id: 'support',
    heading: 'Support',
    blurb: 'How to reach a person, and how quickly.',
    items: FAQ_SUPPORT,
  },
];

export const ALL_FAQS: readonly Faq[] = FAQ_GROUPS.flatMap((group) => group.items);
