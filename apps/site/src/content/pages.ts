export type Segment = { text: string; strong?: boolean };

export type Paragraph = readonly Segment[];

export type Block = {
  eyebrow: string;
  heading?: string;
  paragraphs: readonly Paragraph[];
};

export type Intro = {
  eyebrow: string;
  heading: string;
  lead: string;
};

export type Faq = { question: string; answer: string };

export function paragraphText(paragraph: Paragraph): string {
  return paragraph.map((segment) => segment.text).join('');
}

export function plain(text: string): Paragraph {
  return [{ text }];
}

export function rich(text: string): Paragraph {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter((part) => part.length > 0)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**')
        ? { text: part.slice(2, -2), strong: true }
        : { text: part },
    );
}

export const HOME_INTRO: Intro = {
  eyebrow: 'Project memory and handoff',
  heading: 'Your agent forgets.',
  lead: 'Your teammate never knew. Mneia captures what a session decided at the moment work stops, and gives it to whoever picks the work up next — the same person tomorrow, a colleague next week, or a different agent on the next task.',
};

export const HOME_PROBLEM: Block = {
  eyebrow: 'The problem',
  heading: 'Three hours of context, gone by Tuesday.',
  paragraphs: [
    [
      {
        text: 'A developer works with Claude Code or Cursor for three hours on Monday. They establish twenty decisions along the way: why Postgres over DynamoDB, which auth pattern, which edge cases are out of scope, what broke when they tried the obvious approach.',
      },
    ],
    [
      { text: 'On Tuesday they open a new session. The agent knows none of it.', strong: true },
      { text: ' They spend the first fifteen minutes re-explaining.' },
    ],
    [
      {
        text: 'Worse: mid-session, auto-compaction fires. The agent silently loses the constraint established two hours ago and confidently proposes the approach that was already rejected.',
      },
    ],
    [
      { text: 'Worse still: a teammate picks up the work. ' },
      {
        text: "The decisions live in a chat transcript that was compacted away, or in one person's head.",
        strong: true,
      },
    ],
    [
      {
        text: 'None of this is a tooling gap you can close with a better prompt. The context that mattered was never written down anywhere durable, and the one place it existed was designed to be thrown away.',
      },
    ],
  ],
};

export const HOME_ARTIFACT: Intro = {
  eyebrow: 'The artifact',
  heading: 'This is the thing we ship.',
  lead: 'Not a memory store you query. An object you receive, with every line marked by who asserted it.',
};

export const HOME_OPERATIONS_INTRO = {
  eyebrow: 'Three operations',
  heading: 'Everything else serves these.',
};

export const HOME_SURFACES: Block = {
  eyebrow: 'Where it runs',
  heading: 'In the tools you already work in.',
  paragraphs: [
    [
      {
        text: 'An MCP server that works in Claude Code, Cursor, Codex, or any MCP client. A CLI that also opens an interactive session when you run it bare. File interop with the AGENTS.md and CLAUDE.md you already keep. Plus a deliberately thin web app for the things a terminal is bad at.',
      },
    ],
    [
      { text: 'The inner loop stays in your terminal.', strong: true },
      {
        text: " A handoff that only works inside one vendor's tool is not a handoff, it is a session feature.",
      },
    ],
    [
      {
        text: 'Nothing here asks you to change how you work. You keep your editor, your agent, and your files; Mneia is the thing underneath them that remembers.',
      },
    ],
  ],
};

export const HOME_START: Intro = {
  eyebrow: 'Get started',
  heading: 'Free for one. The point is the second person.',
  lead: 'Create a workspace, install the CLI and the MCP server from npm, and checkpoint your first session — about five minutes. Then invite the teammate who will pick the work up, because that is the half nobody else builds.',
};

export const OPERATIONS = [
  {
    index: '01',
    title: 'Checkpoint',
    body: 'At a task or day boundary, extract the decisions, constraints, and open questions out of the session. Detect contradictions with what is already known. Ask a human to confirm the load-bearing ones.',
    aside: 'Explicit capture at a boundary, not ambient capture that produces noise.',
  },
  {
    index: '02',
    title: 'Rehydrate',
    body: 'Given the next task and a token budget, assemble the minimal high-signal slice. Not replay-everything, and not raw semantic search. Semantic search returns what is similar, not what is load-bearing.',
    aside: 'Active constraints are always included, whatever the budget pressure.',
  },
  {
    index: '03',
    title: 'Handoff',
    body: 'Produce something a person or an agent receives: what is done, current state, open questions, constraints, next action. Provenance on every line, so the receiver knows what to trust.',
    aside: 'The artifact, not a memory store you have to know how to query.',
  },
] as const;

export const HANDOFF_INTRO: Intro = {
  eyebrow: 'The artifact',
  heading: 'What a handoff actually looks like.',
  lead: 'Every competitor built a place to store context and a way to query it. That is a database posture. The job to be done is a transfer.',
};

export const HANDOFF_CAPTION = 'Rendered markdown, frozen at creation, plus a live link.';

export const HANDOFF_SECTIONS_INTRO = {
  eyebrow: 'Section by section',
  heading: 'Why each block is in there.',
};

export const HANDOFF_SECTIONS = [
  {
    index: 'Next action',
    title: 'One instruction, not a summary',
    body: 'The receiver should not have to derive what to do from a wall of state. The first thing in the artifact is the single next move, and whether anything blocks it.',
  },
  {
    index: 'Constraints',
    title: 'Marked by who set them',
    body: 'A human-confirmed constraint and an unconfirmed agent assertion are not the same object and must not look the same. Human items carry the accent; agent items are muted until a human confirms them.',
  },
  {
    index: 'Decisions',
    title: 'Carrying the rationale',
    body: 'A decision without its reasoning gets re-litigated the moment someone new arrives. Every decision states why, and what alternative it beat.',
  },
  {
    index: 'Open questions',
    title: 'Unresolved, and visibly so',
    body: 'Including who owns them and how long they have been sitting. An open question with no owner since three weeks ago is information about the project, not just about the task.',
  },
  {
    index: 'Superseded',
    title: 'The section nobody else produces',
    body: 'What was tried, rejected, and must not be proposed again. This is the highest-value block in the artifact and the reason a fresh agent does not walk straight back into the approach the team already ruled out.',
  },
  {
    index: 'Artifacts',
    title: 'Pointers to the real work',
    body: 'PRs, ADRs, tickets. The handoff does not duplicate them, it locates them.',
  },
] as const;

export const THESIS_QUOTE = 'The unit of value is not memory. It is the handoff.';

export const HANDOFF_THESIS: Block = {
  eyebrow: 'The thesis',
  paragraphs: [
    [
      {
        text: 'Work stops with one actor and resumes with another: the same human tomorrow, a different human next week, a different agent on the next task. The thing that should exist is an artifact produced at the moment of stopping and consumed at the moment of resuming.',
      },
    ],
    [
      { text: 'It also has to survive crossing tools.', strong: true },
      { text: " If it only works inside one vendor's client, it is not a handoff." },
    ],
  ],
};

export const FEATURES_INTRO: Intro = {
  eyebrow: 'Features',
  heading: 'Five things that exist together nowhere else.',
  lead: 'Individually, several of these have partial answers elsewhere. The combination is what does not exist, and the combination is what a team actually needs.',
};

export const FEATURES = [
  {
    index: '01',
    title: 'The handoff is a first-class object',
    body: 'A receivable artifact produced when work stops and consumed when it resumes. Not a record you have to know how to search for. A thing that arrives.',
    todayLabel: 'Today',
    todayValue: 'Nobody ships this',
    todayBody:
      'Everyone stores memory. Nobody hands off. The closest available thing is "query the memory store", which puts the entire burden on whoever is picking the work up.',
  },
  {
    index: '02',
    title: 'Conflict resolution across humans and agents',
    body: 'Explicit arbitration when a teammate and an agent disagree about project state. Agent versus human-confirmed: the human wins, always, and the agent assertion is stored as disputed rather than silently applied. Human versus human is never auto-resolved.',
    todayLabel: 'Today',
    todayValue: 'Announced, not shipped',
    todayBody:
      'Single-user products have no conflicts by construction. Products that do detect contradictions tend to invalidate the older fact automatically, which is exactly wrong for a decision, where a human has to arbitrate.',
  },
  {
    index: '03',
    title: 'Provenance with actor attribution',
    body: 'Every item records whether a human or an agent asserted it, which one, when, and on what basis. That distinction is rendered everywhere it appears, because it is the distinction that decides what to trust.',
    todayLabel: 'Today',
    todayValue: 'Partial at best',
    todayBody:
      'Some products carry episode-level provenance for facts, or commit history. None distinguish human authority from agent assertion.',
  },
  {
    index: '04',
    title: 'Selective rehydration under a token budget',
    body: 'Choose the minimal correct slice for the next task, with per-kind quotas so a pile of similar facts cannot crowd out every constraint. Load-bearing active constraints are always included, whatever the budget pressure.',
    todayLabel: 'Today',
    todayValue: 'Compaction, which is not selection',
    todayBody:
      'Compaction and context editing shrink the window. They do not select for the task at hand. Compaction is lossy by design and task-blind, and semantic search returns what is similar rather than what is load-bearing.',
  },
  {
    index: '05',
    title: 'Boundary-triggered structured checkpoints',
    body: 'Explicit capture at a task or day boundary into a typed schema, with contradiction detection before anything is written, and human confirmation on the load-bearing items.',
    todayLabel: 'Today',
    todayValue: 'Ambient, or threshold-triggered',
    todayBody:
      'Ambient capture produces noise. Threshold compaction fires when the window is full, which is the worst possible moment, and it produces nothing you can review.',
  },
] as const;

export const FEATURES_COMPOUND: Block = {
  eyebrow: 'Why it compounds',
  paragraphs: [
    [
      {
        text: 'After a year of checkpointing, your project carries its own history: what was decided, why, who confirmed it, and what was already ruled out. That record is yours, it is specific to your work, and it gets more useful every month it grows.',
      },
    ],
    [
      { text: 'Which is also why the switching cost runs the right way.', strong: true },
      {
        text: ' A competitor can copy a feature list in a quarter. What they cannot copy is the year your team spent deciding things, because it is your history rather than our software.',
      },
    ],
  ],
};

export const FEATURES_COMPOUND_QUOTE = 'The value is not the feature list. It is the record.';

export const FEATURES_FAQ: readonly Faq[] = [
  {
    question: 'What is Mneia?',
    answer:
      'Mneia is the shared project memory and handoff layer for teams working with AI agents. It does three things: checkpoint, which captures the decisions, constraints, and open questions out of a session at a task or day boundary; rehydrate, which assembles the minimal high-signal context slice for the next task under a token budget; and handoff, which produces a receivable artifact when work changes hands.',
  },
  {
    question: 'How is Mneia different from an AI memory tool?',
    answer:
      'Memory tools give you a place to store context and a way to query it, which leaves the burden on whoever is picking the work up. Mneia produces a handoff: an object a person or an agent receives, stating what is done, current state, open questions, constraints, and the single next action. It also carries a superseded section recording what was tried and rejected, so a fresh agent does not propose the approach the team already ruled out.',
  },
  {
    question: 'Why is context compaction a problem?',
    answer:
      'Compaction is lossy by design and task-blind. It fires when the context window is full, which is the worst possible moment, and it produces nothing you can review. An agent that has been compacted can silently lose a constraint established two hours earlier and confidently propose an approach that was already rejected.',
  },
  {
    question: 'What happens when a human and an agent disagree?',
    answer:
      'The human wins, always. An agent assertion that contradicts a human-confirmed item is stored as disputed rather than silently applied. Two humans disagreeing is never auto-resolved, because arbitrating between two people is not a decision software should make on their behalf.',
  },
  {
    question: 'Which AI coding tools does Mneia work with?',
    answer:
      'Mneia ships an MCP server that works in Claude Code, Cursor, Codex, or any MCP client, plus a CLI and file interop with the AGENTS.md and CLAUDE.md files you already keep. The inner loop stays in your terminal, because a handoff that only works inside one vendor tool is a session feature rather than a handoff.',
  },
  {
    question: 'Does Mneia replace my agent framework or observability stack?',
    answer:
      'No. Mneia sits beside the frameworks and observability tools you already run, never above them. It is not an agent orchestrator, not a tracing or evals product, not an enterprise document search, and not an agent of its own. Everything it builds serves checkpoint, rehydrate, and handoff.',
  },
];

export const PRICING_INTRO: Intro = {
  eyebrow: 'Pricing',
  heading: 'Priced per seat, metered on one thing.',
  lead: 'There is exactly one action in the product with a real marginal cost. Everything else is a database query, and we do not think you should be counting those.',
};

export const TIERS = [
  {
    name: 'Solo',
    price: 'Free',
    amount: 0,
    unit: '',
    note: 'Free, and not a trial. Individual use is how the product spreads, so charging for it would be charging for our own distribution.',
    contents: [
      'Your own workspace',
      'Checkpoint and rehydrate',
      'MCP server and CLI',
      'Capped checkpoints per day',
    ],
    featured: false,
  },
  {
    name: 'Team',
    price: '$24',
    amount: 24,
    unit: ' / user / month',
    note: 'The difference that matters: more than one person writing to the same project memory.',
    contents: [
      'Everything in Solo',
      'Invite colleagues into one workspace',
      'Owner, admin, and member roles',
      'Shared projects across the team',
      'Higher checkpoint allowance',
    ],
    featured: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    amount: null,
    unit: '',
    note: 'For organisations that need a contract, not a card.',
    contents: [
      'Everything in Team',
      'SSO through your identity provider',
      'Support SLA',
      'Invoicing and a signed DPA',
    ],
    featured: false,
  },
] as const;

export const PRICING_PREVIEW: Paragraph = [
  { text: 'Pricing is in preview, and self-serve billing is not live yet.', strong: true },
  {
    text: ' Nothing is charged today — write to us and we will set your team up directly. Two things are still moving: the seat price is not final until we have measured what a real checkpoint costs us to run, and the tiers above list only what ships today. Conflict resolution, handoffs, permission scopes, audit export, data residency, and bring-your-own-cloud are on the roadmap and are deliberately not sold as though they were here.',
  },
];

export const PRICING_METERING: Block = {
  eyebrow: 'What gets metered',
  heading: 'One line item, not a bill you have to parse.',
  paragraphs: [
    [
      {
        text: 'A checkpoint runs an extraction pass over your session. That call is the cost. The seat price includes an allowance set at several times ordinary use, so a normal month never touches it. The ceiling exists so a runaway loop in CI cannot quietly invert the economics.',
      },
    ],
  ],
};

export const METERING = [
  {
    action: 'Checkpoint',
    cost: 'The extraction call, effectively the entire marginal cost',
    metered: 'Metered',
  },
  {
    action: 'Contradiction detection',
    cost: 'Small, runs on a higher-tier model',
    metered: 'Rolled into the checkpoint',
  },
  {
    action: 'Rehydrate',
    cost: 'One indexed query. Fractions of a cent',
    metered: 'Not metered',
  },
  {
    action: 'Handoff, log, status, search',
    cost: 'Negligible',
    metered: 'Not metered',
  },
  {
    action: 'Storage',
    cost: 'Meaningful only at extremes',
    metered: 'Fair-use ceiling only',
  },
] as const;

export const PRICING_NO_KEY: Block = {
  eyebrow: 'No key required',
  heading: 'We pay for inference, not you.',
  paragraphs: [
    [
      {
        text: 'You will not be asked for a model provider key. Charging a seat price and then asking you to fund the model calls on top would be charging for the same product twice, and it would put our costs on your monthly bill.',
      },
    ],
    [
      { text: 'The consequence is ours to carry:', strong: true },
      {
        text: ' the seat price has variable cost inside it, which is exactly why the included allowance is a real number rather than a formality.',
      },
    ],
  ],
};

export const PRICING_FAQ: readonly Faq[] = [
  {
    question: 'How much does Mneia cost?',
    answer:
      'Solo is free. Team is $24 per user per month and includes a checkpoint allowance sized well above ordinary use. Enterprise is custom priced, for organisations that need a contract rather than a card. Two caveats worth stating plainly: self-serve billing is not live yet, so nothing is charged today and we set teams up directly; and the seat price is not final until we have measured what a real checkpoint costs to run. If it moves, it moves before anyone is billed.',
  },
  {
    question: 'Is the free tier a trial?',
    answer:
      'No. Solo is free and stays free. Individual use is how the product spreads, so charging for it would be charging for our own distribution. It covers your own workspace, checkpoint and rehydrate, the MCP server and the CLI, with a daily checkpoint cap.',
  },
  {
    question: 'What exactly is metered?',
    answer:
      'Only the checkpoint, because the extraction call it runs is effectively the entire marginal cost. Contradiction detection is rolled into the checkpoint. Rehydrate is one indexed query costing fractions of a cent and is not metered. Handoff, log, status, and search are not metered. Storage carries a fair-use ceiling only.',
  },
  {
    question: 'Do I need to bring my own model provider API key?',
    answer:
      'No. We pay for inference, not you. Charging a seat price and then asking you to fund the model calls on top would be charging for the same product twice. The seat price carries the variable cost, which is why the included checkpoint allowance is a real number rather than a formality.',
  },
  {
    question: 'What does the Team plan add over Solo?',
    answer:
      'The thing the product is actually for: more than one person writing to the same project memory. You invite colleagues into one workspace, they land in yours rather than a new one of their own, projects are shared across the team, and roles are owner, admin, and member. Conflict resolution, team handoffs, and the review app are on the roadmap and are not in the plan yet.',
  },
];

export const ABOUT_INTRO: Intro = {
  eyebrow: 'About',
  heading: 'The context layer is permanent. Nobody built it for teams.',
  lead: 'Mneia is the shared project memory and handoff layer for teams working with AI agents. Three operations: checkpoint, rehydrate, handoff. Everything else serves them.',
};

export const ABOUT_BET: Block = {
  eyebrow: 'The bet',
  heading: 'In five sentences.',
  paragraphs: [
    [
      { text: 'Long-running agent sessions degrade.', strong: true },
      {
        text: ' Context windows fill, compaction is lossy, and recall drops well before the window is full. This is measured, not anecdotal.',
      },
    ],
    [
      { text: 'Every provider has responded by externalising context', strong: true },
      {
        text: ': memory tools, compaction, project instruction files. Which means the context layer is a permanent architectural component, not a temporary hack.',
      },
    ],
    [
      { text: 'The existing products are built for one user and one agent.', strong: true },
      {
        text: ' Nobody has built the layer for several humans and several agents working the same project over weeks.',
      },
    ],
    [
      { text: 'Our wedge is the artifact nobody ships: a handoff.', strong: true },
      {
        text: ' Not a memory store you query, but an object a person or an agent receives when picking work up.',
      },
    ],
    [
      { text: 'What keeps a team is not the feature list.', strong: true },
      {
        text: " It is becoming the record of what the team decided and why, which is not something a competitor can copy, because it is the customer's own history.",
      },
    ],
  ],
};

export const ABOUT_THESIS: Block = {
  eyebrow: 'The thesis',
  paragraphs: [
    [
      {
        text: 'Every competitor built a place to store context and a way to query it. That is a database posture. The actual job is a transfer: work stops with one actor and resumes with another.',
      },
    ],
    [
      { text: 'Two things follow. ' },
      { text: 'Once work is transferred between people', strong: true },
      {
        text: ', the store has to handle several writers, which forces provenance, conflict resolution, and permissions, and those cannot be bolted onto a single-user product without changing its thesis. ',
      },
      { text: 'And a handoff has to survive crossing tools.', strong: true },
      {
        text: ' Model providers are structurally incentivised against that kind of neutrality. The gap is permanent.',
      },
    ],
  ],
};

export const ABOUT_AUDIENCE: Block = {
  eyebrow: 'Who it is for',
  heading: 'Built for a company, landed through engineering.',
  paragraphs: [
    [
      {
        text: 'Context does not stop at a team boundary. A decision made in the payments team changes what sales can promise; an open question in platform blocks three feature teams. So the data model assumes the company from the first migration: teams as a first-class entity, a visibility hierarchy, function on the team. The sales motion does not.',
      },
    ],
  ],
};

export const AUDIENCE = [
  {
    who: 'The individual developer',
    what: 'Living in Claude Code, Cursor, or Codex daily. Cross-session context loss, compaction damage, re-explaining. Free tier, permanently.',
  },
  {
    who: 'A tech lead on a small team',
    what: 'Especially mid-migration or mid-refactor. Context sits in individual heads, onboarding onto in-flight work is expensive, and agents contradict decisions that were already settled.',
  },
  {
    who: 'A multi-team engineering org',
    what: 'No record of what agents decided or why. No audit trail. No governance over what context an agent is allowed to see.',
  },
  {
    who: 'The company around engineering',
    what: 'Support, sales, and operations people build with agents too. They have a real question with no trustworthy current answer: is this on the roadmap, who owns it, what is the state?',
  },
] as const;

export const ABOUT_LICENSING: Block = {
  eyebrow: 'Licensing',
  heading: 'Open clients, hosted service.',
  paragraphs: [
    [
      {
        text: 'The client packages are Apache 2.0: the CLI, the MCP server, and the core, which holds the schema definitions, the handoff format, the extraction prompts, and the ranking algorithm. The hosted API, the store, billing, and the review surfaces are proprietary.',
      },
    ],
    [
      { text: 'Being straight about what that means:', strong: true },
      {
        text: ' Mneia runs as a hosted service. The clients require an account and do not function without it. We would rather say so here than have you find out after installing.',
      },
    ],
  ],
};

export const ABOUT_SCOPE: Block = {
  eyebrow: 'Scope',
  heading: 'Three operations, done properly.',
  paragraphs: [
    [
      {
        text: 'Checkpoint, rehydrate, handoff. We sit beside the frameworks and the observability tools you already run, never above them, and everything we build serves those three operations rather than competing with the rest of your stack.',
      },
    ],
  ],
};
