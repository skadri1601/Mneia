import { CONTACT } from './legal';
import type { Block, Intro } from './pages';

export type ContactChannel = {
  id: string;
  label: string;
  address: string;
  what: string;
  note: string;
};

export const CONTACT_INTRO: Intro = {
  eyebrow: 'Contact',
  heading: 'Four addresses, and a person behind each one.',
  lead: 'Mneia is a small team. Nothing below routes into a ticket queue - pick the address that matches what you need and it reaches someone who can act on it.',
};

export const CONTACT_CHANNELS: readonly ContactChannel[] = [
  {
    id: 'privacy',
    label: 'Privacy and data rights',
    address: CONTACT.privacy,
    what: 'Access, correction, deletion, portability, and objection requests under the GDPR, the CCPA and other US state laws, and India’s DPDP Act.',
    note: 'Answered within the statutory window set out in the Privacy Policy. Tell us which right you are exercising and the email address your account or waitlist entry uses.',
  },
  {
    id: 'security',
    label: 'Security',
    address: CONTACT.security,
    what: 'Vulnerability reports, suspected exposure, and anything about the service that looks like a security problem.',
    note: 'Include enough detail to reproduce it. Please do not include anyone else’s data in the report, and give us a chance to fix it before publishing.',
  },
  {
    id: 'legal',
    label: 'Legal and licensing',
    address: CONTACT.legal,
    what: 'The Terms, the Apache 2.0 client packages, enterprise agreements, and anything contractual.',
    note: 'The client packages are Apache 2.0 and need no permission from us to use. The hosted service is proprietary, and that is the part worth writing about.',
  },
  {
    id: 'grievance',
    label: 'Grievance officer',
    address: CONTACT.grievance,
    what: 'The escalation route required by India’s DPDP Act for data principals who are not satisfied with the answer they received.',
    note: 'Use this after privacy@ has replied, or if it has not replied inside the statutory window.',
  },
];

export const CONTACT_ACCESS: Block = {
  eyebrow: 'Getting started',
  heading: 'You do not need to ask us for access.',
  paragraphs: [
    [
      {
        text: 'Sign up at app.mneia.dev and install the clients from npm - there is no queue and nothing to request. If a colleague has already started, ask them to invite you instead, because accepting an invitation puts you in their workspace rather than a new one of your own.',
      },
    ],
    [
      { text: 'If you are still on the waitlist,', strong: true },
      {
        text: ' you no longer need to wait for us, and the unsubscribe link hard-deletes your address rather than flagging it.',
      },
    ],
  ],
};

export const CONTACT_NOT_YET: Block = {
  eyebrow: 'What is not here',
  paragraphs: [
    [
      {
        text: 'There is no phone number and no chat widget, because there is no team behind them and a channel nobody answers is worse than one that does not exist. Enterprise plans carry a support SLA as a contracted term; everything else reaches a person at the addresses above.',
      },
    ],
  ],
};

export type HelpTask = {
  question: string;
  answer: string;
  href: string;
  linkLabel: string;
};

export type HelpSymptom = {
  symptom: string;
  cause: string;
  fix: string;
};

export const HELP_INTRO: Intro = {
  eyebrow: 'Help',
  heading: 'Start here when something is not working.',
  lead: 'The common tasks, the errors people actually hit, and where to go when neither of those covers it.',
};

export const HELP_PATHS = [
  {
    index: '01',
    title: 'New to Mneia',
    body: 'Install the CLI, connect an MCP client, and run your first checkpoint and rehydration end to end.',
    href: '/docs/quickstart',
    linkLabel: 'Read the quickstart',
  },
  {
    index: '02',
    title: 'Connecting an agent',
    body: 'The eleven tools the MCP server exposes, what each is for, and how to configure Claude Code, Cursor, or Codex to see them.',
    href: '/docs/mcp',
    linkLabel: 'MCP server reference',
  },
  {
    index: '03',
    title: 'Day-to-day commands',
    body: 'Every command, its flags, its JSON output, and the exit codes worth branching on in CI.',
    href: '/docs/cli',
    linkLabel: 'CLI reference',
  },
  {
    index: '04',
    title: 'Understanding the model',
    body: 'The three operations, the vocabulary, provenance, and why a superseded item is kept rather than deleted.',
    href: '/docs/concepts',
    linkLabel: 'Concepts',
  },
] as const;

export const HELP_TASKS: readonly HelpTask[] = [
  {
    question: 'How do I connect a repository to a project?',
    answer:
      'Run mneia init in the repository root. It writes .mneia/config.json, imports the constraints already sitting in your AGENTS.md, CLAUDE.md, or .cursor/rules, writes a generated section back into AGENTS.md inside a fence it owns, and installs the session-start hook so Claude Code, Codex, and Cursor load the project memory on their own.',
    href: '/docs/quickstart',
    linkLabel: 'Quickstart',
  },
  {
    question: 'How do I authenticate a machine, or CI?',
    answer:
      'Interactively, mneia login writes a token to ~/.mneia/credentials. Non-interactively, set MNEIA_TOKEN in the environment - that is the path for CI and for an MCP client that starts the server without a shell.',
    href: '/docs/cli',
    linkLabel: 'CLI reference',
  },
  {
    question: 'How do I see what the project already knows?',
    answer:
      'mneia brief "<what you are about to work on>" prints the rehydrated slice for that task. mneia log shows the decision history newest first, and mneia status shows what is stale, disputed, or unanswered.',
    href: '/docs/cli',
    linkLabel: 'CLI reference',
  },
  {
    question: 'How do I record a decision without waiting for a checkpoint?',
    answer:
      'Call mneia_assert the moment it is settled. A checkpoint is for a batch at a boundary; assert is for the single decision you do not want to lose in the next hour.',
    href: '/docs/mcp',
    linkLabel: 'MCP server reference',
  },
  {
    question: 'How do I correct something that is now wrong?',
    answer:
      'Supersede it rather than deleting it, by passing supersedesId on the replacement. The old item stays, marked superseded, which is what stops a fresh agent from proposing the approach the team already ruled out.',
    href: '/docs/concepts',
    linkLabel: 'Concepts',
  },
  {
    question: 'How do I turn telemetry off?',
    answer:
      'Set MNEIA_TELEMETRY=off in the environment of the CLI or the MCP server. Any of off, false, no, none, or 0 works, and an unrecognised value is rejected loudly rather than silently leaving telemetry on.',
    href: '/docs/cli',
    linkLabel: 'CLI reference',
  },
  {
    question: 'How do I point a client at a different API endpoint?',
    answer:
      'Set MNEIA_API_URL, or pass --endpoint to mneia init to persist it in .mneia/config.json. The default is https://app.mneia.dev.',
    href: '/docs/cli',
    linkLabel: 'CLI reference',
  },
];

export const HELP_SYMPTOMS: readonly HelpSymptom[] = [
  {
    symptom: 'no Mneia project is bound to this directory',
    cause:
      'There is no .mneia/config.json where the command ran, so nothing tells it which project it is talking about.',
    fix: 'Run mneia init in the repository root. If the repository is already bound elsewhere and you mean to rebind it, add --force.',
  },
  {
    symptom: 'no Mneia credentials found',
    cause:
      'MNEIA_TOKEN is unset and ~/.mneia/credentials does not exist, so there is no token to authenticate with.',
    fix: 'Run mneia login on a machine with a browser, or set MNEIA_TOKEN directly in CI and in your MCP client’s server configuration.',
  },
  {
    symptom: 'MNEIA_TOKEN is set but empty',
    cause:
      'The variable exists with a blank or whitespace value - usually an unresolved secret reference in CI, or a shell export that lost its value.',
    fix: 'Set it to the token value alone: no Bearer prefix, no quotes, no trailing newline. Unsetting it entirely falls back to the credentials file, which is often what you want locally.',
  },
  {
    symptom: 'the config file is not valid JSON, or a field is rejected',
    cause:
      'A hand-edited .mneia/config.json. The file is validated on read, so a malformed binding fails immediately rather than half-working.',
    fix: 'The error names the offending field. Fix that field, or delete the file and run mneia init to rewrite it.',
  },
  {
    symptom: 'a command reports that this build does not carry it',
    cause:
      'The CLI refuses to pretend a surface exists before the build in front of you has it, so it says which command it is rather than failing as an unknown one.',
    fix: 'Run mneia --help for the commands this build supports, and upgrade with npm install -g @mneia/cli. There is nothing to fix locally.',
  },
  {
    symptom: 'the MCP server exits immediately on startup',
    cause:
      'Configuration is resolved before the server accepts a connection, so a missing token or a malformed endpoint stops it there rather than failing on the first tool call.',
    fix: 'The message names the variable at fault. MCP clients bury server stderr - check the client’s log pane before assuming the server is broken.',
  },
  {
    symptom: 'a tool call comes back as an error rather than a result',
    cause:
      'Arguments are validated before anything is read or written, so an invalid call changes nothing. Every failure carries a code, a summary, and a remedy.',
    fix: 'Correct the arguments and call again. If the failure repeats with the same code, it is ours rather than yours - send it to security@mneia.dev if it looks like exposure, and otherwise report it with the code.',
  },
  {
    symptom: 'you need the underlying stack trace',
    cause:
      'The CLI prints a message and a fix rather than a stack, because a stack is rarely the useful part.',
    fix: 'Set MNEIA_DEBUG=1 and re-run. Add --json to any command for machine-readable output, including the error shape.',
  },
];

export const HELP_ESCALATION: Block = {
  eyebrow: 'Still stuck',
  heading: 'When the documentation does not cover it.',
  paragraphs: [
    [
      {
        text: 'There is no support desk. What exists instead is a small set of addresses that reach a person, and a documentation set we would rather fix than answer the same question twice from. Enterprise plans carry a support SLA as a contracted term.',
      },
    ],
    [
      { text: 'If something here is wrong or missing, that is a bug.', strong: true },
      { text: ' Say so, and it gets corrected rather than filed.' },
    ],
  ],
};
