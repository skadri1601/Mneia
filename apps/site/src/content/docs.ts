import type { Intro } from './pages';

export type DocBlock =
  | { kind: 'text'; paragraphs: readonly string[] }
  | { kind: 'bullets'; items: readonly string[] }
  | { kind: 'steps'; items: readonly { title: string; body: string }[] }
  | { kind: 'code'; label: string; lines: readonly string[] }
  | { kind: 'table'; head: readonly string[]; rows: readonly (readonly string[])[] }
  | { kind: 'note'; text: string };

export type DocSection = {
  id: string;
  heading: string;
  blocks: readonly DocBlock[];
};

export type DocSlug = 'quickstart' | 'concepts' | 'cli' | 'mcp';

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

export type DocsNavItem = { href: string; label: string; badge?: string };

export type DocsNavGroup = { heading: string; items: readonly DocsNavItem[] };

export const DOCS_NAV: readonly DocsNavGroup[] = [
  {
    heading: 'Start',
    items: [
      { href: '/docs', label: 'Overview' },
      { href: '/docs/quickstart', label: 'Quickstart' },
      { href: '/docs/concepts', label: 'Concepts' },
    ],
  },
  {
    heading: 'Reference',
    items: [
      { href: '/docs/cli', label: 'CLI' },
      { href: '/docs/mcp', label: 'MCP server' },
    ],
  },
  {
    heading: 'Ships later',
    items: [
      { href: '/handoff', label: 'Handoff artifact', badge: 'M2' },
      { href: '/features', label: 'Conflict resolution', badge: 'M4' },
    ],
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
    'CONSTRAINTS (2 active, human-confirmed)',
    '  · No downtime window; the cutover must be online',
    '  · Ledger writes stay idempotent under retry',
    '',
    'SUPERSEDED (do not re-propose)',
    '  · Read from the shadow table in the worker',
    '    → replaced by: read from v2 directly',
    '',
    '14 items considered · 6 included · 1,840 tokens · 96ms',
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
    body: 'Item kinds, provenance, superseding, and how a rehydration slice is actually chosen.',
  },
  {
    href: '/docs/cli',
    title: 'CLI',
    body: 'Every command and flag, the environment variables, the JSON contract, and the exit codes.',
  },
  {
    href: '/docs/mcp',
    title: 'MCP server',
    body: 'The four tools your agent can call, how to configure the server, and how failures come back.',
  },
] as const;

export const DOCS_INTRO: Intro = {
  eyebrow: 'Documentation',
  heading: 'How Mneia works, and how to run it.',
  lead: 'Four pages. Start with the quickstart if you have access, with concepts if you are still deciding, and use the two reference pages when you need the exact flag.',
};

export const DOCS_STATUS =
  'Mneia is in staged early access. Everything documented about the command surface and the tool surface is built and behaves as described. The client packages are not on npm yet, so the install steps describe what happens when your account is enabled rather than something you can run today.';

const QUICKSTART: DocPage = {
  slug: 'quickstart',
  name: 'Quickstart',
  title: 'Quickstart',
  description:
    'Install the Mneia CLI, authenticate, bind a repository to a project, connect an MCP client, and run your first checkpoint and rehydration.',
  eyebrow: 'Documentation',
  heading: 'From nothing to a rehydrated session.',
  lead: 'Six steps. The first four are once per machine or once per repository; the last two are the loop you repeat.',
  minutes: 8,
  sections: [
    {
      id: 'before-you-start',
      heading: 'Before you start',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'You need an enabled Mneia account and Node.js 20 or newer. Access is granted in stages from the waitlist, and the packages install once your account is enabled.',
            'You do not need a model provider key. Mneia pays for the inference a checkpoint runs, so there is nothing to configure and nothing of ours on your provider bill.',
          ],
        },
      ],
    },
    {
      id: 'install',
      heading: '1. Install the clients',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Two packages. The CLI is the surface you drive; the MCP server is the surface your agent drives. Most people install both, globally, because both are used across repositories.',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: ['npm install -g @mneia/cli @mneia/mcp-server', '', 'mneia --version'],
        },
        {
          kind: 'note',
          text: 'The CLI installs the **mneia** binary and the MCP server installs **mneia-mcp**. You never run mneia-mcp yourself — an MCP client starts it over stdio.',
        },
      ],
    },
    {
      id: 'authenticate',
      heading: '2. Authenticate the machine',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Interactively, **mneia login** approves the machine in a browser and writes a token to `~/.mneia/credentials`. Non-interactively — CI, a container, an MCP client started without a shell — set **MNEIA_TOKEN** in the environment instead. The environment variable wins when both are present.',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: [
            'mneia login',
            '',
            '# or, where there is no browser:',
            'export MNEIA_TOKEN="<token>"',
          ],
        },
        {
          kind: 'note',
          text: 'Set the token value alone — no `Bearer` prefix, no quotes, no trailing newline. A blank `MNEIA_TOKEN` is rejected rather than silently ignored, because an unresolved CI secret is the usual cause and falling back quietly would hide it.',
        },
      ],
    },
    {
      id: 'bind',
      heading: '3. Bind the repository to a project',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Run **mneia init** in the repository root. It derives the project slug from the directory name unless you name one.',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: ['cd ~/code/payments', 'mneia init --workspace acme --project payments'],
        },
        {
          kind: 'text',
          paragraphs: ['It does three things, and says so:'],
        },
        {
          kind: 'bullets',
          items: [
            'Writes `.mneia/config.json`, binding this directory to a workspace and a project. Commit it — the binding is a property of the repository, not of your laptop.',
            'Reads the `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules` files you already keep, and imports the constraints in them, so the project does not start empty.',
            'Writes a generated section into `AGENTS.md` inside a fence it owns. Nothing outside that fence is touched, and editing inside it is detected rather than overwritten.',
          ],
        },
        {
          kind: 'note',
          text: 'If the repository is already bound and you mean to rebind it, add **--force**. Without it, a conflicting `--workspace` or `--project` is refused rather than silently re-pointing a repository at a different project.',
        },
      ],
    },
    {
      id: 'connect-agent',
      heading: '4. Connect your agent',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The MCP server speaks stdio, so any MCP client can start it. Register it once per client. Claude Code, Cursor, and Codex all take the same shape:',
          ],
        },
        {
          kind: 'code',
          label: 'json',
          lines: [
            '{',
            '  "mcpServers": {',
            '    "mneia": {',
            '      "command": "mneia-mcp",',
            '      "env": {',
            '        "MNEIA_TOKEN": "<token>"',
            '      }',
            '    }',
            '  }',
            '}',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The server resolves its configuration before it accepts a connection, so a missing token or a malformed endpoint stops it at startup rather than on the first tool call. MCP clients tend to bury server stderr — if the tools do not appear, read the client’s log pane before assuming the server is broken.',
            'Drop the `env` block if you ran **mneia login**; the server reads the same credentials file the CLI wrote. The project binding comes from `.mneia/config.json` in the working directory, so the agent inherits it without being told.',
          ],
        },
      ],
    },
    {
      id: 'first-loop',
      heading: '5. Rehydrate, work, checkpoint',
      blocks: [
        {
          kind: 'text',
          paragraphs: ['This is the loop. Everything else is detail.'],
        },
        {
          kind: 'steps',
          items: [
            {
              title: 'Start the task with a rehydration',
              body: 'The agent calls mneia_rehydrate with the task it is about to start. It gets back the active constraints it must not violate, the decisions already made and why, the open questions, and what was recently superseded. Call it unconditionally — it is one indexed query, it is not metered, and the p95 budget for it is 300ms.',
            },
            {
              title: 'Work as you normally would',
              body: 'Nothing about the inner loop changes. When a decision is settled mid-session and you do not want to risk losing it, the agent calls mneia_assert on that one item rather than waiting.',
            },
            {
              title: 'Checkpoint at the boundary',
              body: 'At the end of a task or a day, the agent extracts the candidate decisions, constraints, and open questions from the session and hands them to mneia_checkpoint as one batch. Items that are load-bearing, or that supersede something already there, come back in a pending queue for a human to confirm — they are never written on an agent’s say-so.',
            },
            {
              title: 'Confirm what matters',
              body: 'Surface the pending queue and confirm the load-bearing items. This is the step that makes the record trustworthy later, and it is the one worth not skipping.',
            },
          ],
        },
        {
          kind: 'text',
          paragraphs: ['From the terminal the same loop reads:'],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: [
            'mneia brief "migrate the ledger writes to the v2 schema"',
            '',
            '# ... work ...',
            '',
            'mneia checkpoint',
            'mneia status',
          ],
        },
      ],
    },
    {
      id: 'next',
      heading: '6. Where to go next',
      blocks: [
        {
          kind: 'bullets',
          items: [
            'Read **Concepts** for the vocabulary — item kinds, provenance, superseding, and why a rejected approach is kept rather than deleted.',
            'Read the **CLI reference** for every command, flag, JSON shape, and exit code.',
            'Read the **MCP server reference** for the four tools and when each one is the right call.',
          ],
        },
        {
          kind: 'note',
          text: 'Handoffs — producing a receivable artifact when work changes hands, and picking one up — ship after the current milestone. The CLI and the MCP server both refuse those surfaces by name today rather than pretending they exist.',
        },
      ],
    },
  ],
};

const CONCEPTS: DocPage = {
  slug: 'concepts',
  name: 'Concepts',
  title: 'Concepts',
  description:
    'The three operations, the vocabulary Mneia uses for a context item, how provenance and superseding work, and why conflicts between a human and an agent are resolved the way they are.',
  eyebrow: 'Documentation',
  heading: 'The model underneath the commands.',
  lead: 'Mneia has a small vocabulary and it is used precisely. Knowing these six ideas is enough to predict what any command will do.',
  minutes: 9,
  sections: [
    {
      id: 'operations',
      heading: 'Three operations',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Everything Mneia does serves one of three operations. If a feature does not, it does not belong in the product.',
          ],
        },
        {
          kind: 'table',
          head: ['Operation', 'When it runs', 'What it produces'],
          rows: [
            [
              '**Checkpoint**',
              'At a task or day boundary',
              'Typed items written to project memory, with the load-bearing ones held for human confirmation',
            ],
            [
              '**Rehydrate**',
              'At the start of a task, and whenever the task changes',
              'The minimal high-signal context slice for that task, under a token budget',
            ],
            [
              '**Handoff**',
              'When work changes hands',
              'A receivable artifact: what is done, current state, open questions, constraints, next action',
            ],
          ],
        },
        {
          kind: 'note',
          text: 'Checkpoint and rehydrate are available now. Handoff ships in the next milestone; the artifact it produces is described on **the handoff page**.',
        },
      ],
    },
    {
      id: 'context-item',
      heading: 'The context item',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A context item is the unit of project memory. It has a kind, and the kind decides how it is treated during rehydration — a constraint is not scored against a fact and cannot be crowded out by one.',
          ],
        },
        {
          kind: 'table',
          head: ['Kind', 'What it holds'],
          rows: [
            ['`decision`', 'Something settled, with the reasoning and the alternative it beat'],
            [
              '`constraint`',
              'Something that must hold. The kind that must never be dropped from a slice',
            ],
            ['`open_question`', 'Something unresolved, with an owner and an age'],
            ['`fact`', 'Something true about the project that is neither a ruling nor a rule'],
            ['`artifact_ref`', 'A pointer to the real work — a PR, an ADR, a ticket'],
            ['`note`', 'Context that does not fit the others and is not load-bearing'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Every item carries a **load-bearing** flag. Load-bearing means the work goes wrong without it, and it is the flag that drives both the confirmation requirement and the rehydration guarantee.',
          ],
        },
      ],
    },
    {
      id: 'provenance',
      heading: 'Provenance, and why it is on every line',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every item records who asserted it — a human or an agent, which one, when, and on what basis. That distinction is rendered everywhere the item appears, because it is the distinction that decides what to trust.',
            'A human-confirmed constraint and an unconfirmed agent assertion are not the same object and must not look the same. Most memory products flatten them into one list of facts, which is how a guess acquires the authority of a ruling.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Human-confirmed** — a person read it and said yes. It carries authority.',
            '**Agent-asserted** — extracted from a session and not yet confirmed. Useful, and visibly provisional.',
            '**Disputed** — an assertion that contradicts a human-confirmed item. Stored, flagged, and never silently applied.',
          ],
        },
      ],
    },
    {
      id: 'superseding',
      heading: 'Superseding, not deleting',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'When something is replaced, the replacement points at what it replaced with `supersedesId`. The old item stays, marked superseded, with its reasoning intact.',
            'This is the single highest-value behaviour in the product. What was tried and rejected is exactly what a fresh agent will otherwise propose again on Tuesday, and a deleted item cannot warn anyone. Rehydration includes recent supersessions for that reason.',
          ],
        },
        {
          kind: 'note',
          text: 'A replacement of a human-confirmed item is **never** written automatically. It comes back pending, for a human to confirm. An agent may not overrule a person by writing a row.',
        },
      ],
    },
    {
      id: 'rehydration',
      heading: 'How a slice is chosen',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Rehydration is selection, not compaction and not search. Compaction shrinks the window without knowing the task; semantic search returns what is similar rather than what is load-bearing. Neither is what you want when the thing that must not be dropped is a constraint nobody mentioned in the query.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'The slice is assembled for a **stated task**, under a **token budget** you control.',
            'Per-kind quotas apply, so a pile of similar facts cannot crowd out every constraint.',
            'Load-bearing active constraints are **always included**, whatever the budget pressure. This is a rule, not a heuristic, and it is enforced by a test.',
            'Recent supersessions are included so the agent does not re-propose what was ruled out.',
          ],
        },
      ],
    },
    {
      id: 'conflict',
      heading: 'When two sources disagree',
      blocks: [
        {
          kind: 'table',
          head: ['Disagreement', 'What Mneia does'],
          rows: [
            [
              'Agent contradicts a human-confirmed item',
              'The human wins, always. The agent assertion is stored as disputed rather than applied.',
            ],
            [
              'Agent contradicts an agent assertion',
              'Both are kept and flagged. Neither has authority the other lacks.',
            ],
            [
              'Human contradicts a human',
              '**Never auto-resolved.** It is surfaced for the two people to settle.',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'The last row is the one that matters and the one nobody else implements. Arbitrating between two colleagues is not a decision software should make on their behalf, and quietly picking the newer row is how a team discovers weeks later that a ruling was overwritten.',
          ],
        },
      ],
    },
    {
      id: 'scope',
      heading: 'Workspaces, projects, and who can see what',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'A **workspace** is the tenant. A **project** is a body of work inside it, usually one repository. A **session** is one run of an agent against a project, and it is what a checkpoint summarises.',
            'Every row carries the workspace it belongs to, and the database enforces isolation with Postgres row-level security rather than relying on the application to remember. Privacy is enforced by controls — scope, retention, residency — not by keeping data on your laptop, because a hosted service cannot honestly promise the latter.',
          ],
        },
      ],
    },
  ],
};

const CLI: DocPage = {
  slug: 'cli',
  name: 'CLI reference',
  title: 'CLI reference',
  description:
    'Every Mneia CLI command — init, brief, checkpoint, log, and status — with flags, environment variables, JSON output, and exit codes.',
  eyebrow: 'Documentation',
  heading: 'The mneia command, in full.',
  lead: 'The CLI is a thin surface over the same core the MCP server uses, so the two return the same answer for the same input. Every command takes --json and --help.',
  minutes: 7,
  sections: [
    {
      id: 'commands',
      heading: 'Commands',
      blocks: [
        {
          kind: 'table',
          head: ['Command', 'What it does'],
          rows: [
            [
              '`mneia init`',
              'Attach this repository to a Mneia project and import its existing constraints',
            ],
            ['`mneia brief "<task>"`', 'Print the rehydrated context slice for a stated task'],
            ['`mneia checkpoint`', 'Capture the session into project memory at a boundary'],
            ['`mneia log`', 'Show the decision history for this project, newest first'],
            ['`mneia status`', 'Show what is stale, disputed, or unanswered in this project'],
          ],
        },
        {
          kind: 'note',
          text: '`handoff` and `pickup` ship in M2; `conflicts` ships in M4. Running them today returns a usage error naming the milestone rather than a generic "unknown command", so you can tell "not yet" from "you typed it wrong".',
        },
      ],
    },
    {
      id: 'init',
      heading: 'mneia init',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: [
            'mneia init [--workspace <slug>] [--project <slug>] [--endpoint <url>] [--force] [--json]',
          ],
        },
        {
          kind: 'table',
          head: ['Flag', 'Effect'],
          rows: [
            [
              '`--workspace <slug>`',
              'The workspace to attach to. Lowercase letters, digits, and single `-` `_` `.` separators',
            ],
            [
              '`--project <slug>`',
              'The project slug. Derived from the directory name when omitted',
            ],
            ['`--endpoint <url>`', 'Persist a non-default API URL into `.mneia/config.json`'],
            [
              '`--force`',
              'Rebind a repository that is already bound, or overwrite a config that will not parse',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Constraints are imported from `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules` if they exist, and a generated section is written back into `AGENTS.md` inside a fence Mneia owns. If that fence has been damaged by hand, init stops and says so rather than guessing where the boundary was.',
          ],
        },
      ],
    },
    {
      id: 'brief',
      heading: 'mneia brief',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: ['mneia brief "<task>" [--budget <tokens>] [--json]'],
        },
        {
          kind: 'text',
          paragraphs: [
            'The terminal-side rehydration. State the task in the words you would use to a colleague — the slice is chosen for that task, so "fix the ledger rounding bug" and "migrate the ledger schema" return different context from the same project.',
            '`--budget` caps the slice in tokens. Load-bearing active constraints are included regardless of what you set it to.',
          ],
        },
      ],
    },
    {
      id: 'log-status',
      heading: 'mneia log and mneia status',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: [
            'mneia log [--limit <count>] [--since <duration|date>] [--json]',
            'mneia status [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`log` is the decision history, newest first — what was decided, by whom, and what it superseded. `--since` takes a duration such as `7d` or an absolute date.',
            '`status` is the health of the project rather than its history: what is stale, what is disputed, and which open questions have been sitting unanswered. It is the command worth running before a planning meeting.',
          ],
        },
      ],
    },
    {
      id: 'environment',
      heading: 'Environment variables',
      blocks: [
        {
          kind: 'table',
          head: ['Variable', 'Default', 'What it does'],
          rows: [
            [
              '`MNEIA_TOKEN`',
              '—',
              'The auth token. Wins over the credentials file; required in CI',
            ],
            [
              '`MNEIA_API_URL`',
              '`https://api.mneia.dev`',
              'The API endpoint. Wins over the value in `.mneia/config.json`',
            ],
            [
              '`MNEIA_TELEMETRY`',
              'on',
              'Set to `off`, `false`, `no`, `none`, or `0` to opt out entirely',
            ],
            [
              '`MNEIA_CREDENTIALS_PATH`',
              '`~/.mneia/credentials`',
              'Absolute path to the credentials file',
            ],
            ['`MNEIA_DEBUG`', '—', 'Set to `1` to print the underlying stack trace on failure'],
          ],
        },
        {
          kind: 'note',
          text: 'An unrecognised `MNEIA_TELEMETRY` value is an error, not a fallback. A typo in an opt-out must not quietly leave telemetry on.',
        },
      ],
    },
    {
      id: 'output',
      heading: 'Output and exit codes',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Every command takes `--json`, and the JSON is the contract — human output may be reformatted, the JSON shape may not. Errors carry a kind, a message naming what was expected and what was received, and a fix.',
          ],
        },
        {
          kind: 'table',
          head: ['Code', 'Meaning'],
          rows: [
            ['`0`', 'Success'],
            ['`1`', 'Failed — the operation was understood and did not succeed'],
            ['`2`', 'Usage — the invocation was wrong. Nothing was read or written'],
            ['`3`', 'Not configured — no `.mneia/config.json` for this directory'],
            ['`4`', 'Auth — no usable token'],
            ['`5`', 'Network — the API could not be reached. Your token was not the problem'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Separating 3, 4, and 5 is what lets a CI step retry a network failure and fail fast on a missing binding, instead of treating every non-zero exit as the same event.',
          ],
        },
      ],
    },
  ],
};

const MCP: DocPage = {
  slug: 'mcp',
  name: 'MCP server reference',
  title: 'MCP server reference',
  description:
    'The four Mneia MCP tools — mneia_rehydrate, mneia_assert, mneia_checkpoint, and mneia_search — how to configure the server, and when to call each one.',
  eyebrow: 'Documentation',
  heading: 'Four tools your agent can call.',
  lead: 'The MCP server is client-neutral by design. It speaks stdio, it works in Claude Code, Cursor, Codex, or anything else that speaks MCP, and it exposes no vendor-specific behaviour.',
  minutes: 7,
  sections: [
    {
      id: 'configure',
      heading: 'Configuring the server',
      blocks: [
        {
          kind: 'code',
          label: 'json',
          lines: [
            '{',
            '  "mcpServers": {',
            '    "mneia": {',
            '      "command": "mneia-mcp",',
            '      "env": {',
            '        "MNEIA_TOKEN": "<token>"',
            '      }',
            '    }',
            '  }',
            '}',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Omit `env` if you ran **mneia login** — the server reads the same `~/.mneia/credentials` the CLI wrote. The project binding comes from `.mneia/config.json` in the working directory, so an agent working in a bound repository needs no further configuration.',
            'Configuration is resolved before the server accepts a connection. A missing token, an empty token, a malformed endpoint, or an unparseable project config stops the server at startup with a message naming the variable at fault.',
          ],
        },
      ],
    },
    {
      id: 'tools',
      heading: 'The tools',
      blocks: [
        {
          kind: 'table',
          head: ['Tool', 'Call it when'],
          rows: [
            [
              '`mneia_rehydrate`',
              'Starting a task, and whenever the task changes. Cheap, safe to call unconditionally',
            ],
            ['`mneia_assert`', 'One thing is settled mid-session and should not be lost'],
            ['`mneia_checkpoint`', 'A batch of items is being captured at a task or day boundary'],
            ['`mneia_search`', 'You already know the specific thing you are looking for'],
          ],
        },
      ],
    },
    {
      id: 'rehydrate',
      heading: 'mneia_rehydrate',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Loads the minimal high-signal slice for the task about to start: the active constraints that must not be violated, the decisions already made and why, the open questions, and what was recently superseded so it is not re-proposed.',
            'Returns rendered markdown plus the slice id and the ids of the included items, so a later checkpoint can be correlated with what the agent was actually shown. Its p95 latency budget is 300ms — a rehydration nobody waits for is a rehydration nobody calls.',
          ],
        },
        {
          kind: 'note',
          text: 'Reach for `mneia_search` instead when you already know what you are after. Rehydration answers "what do I need to know here?"; search answers "where is this one thing?".',
        },
      ],
    },
    {
      id: 'assert',
      heading: 'mneia_assert',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Records one durable item as soon as it is settled, without waiting for a checkpoint. Use it the moment a decision is made, a constraint is stated, or a question is left open.',
            'Pass `supersedesId` when the item replaces an existing one. A replacement of a human-confirmed item is never written automatically — it comes back pending for a human to confirm.',
          ],
        },
      ],
    },
    {
      id: 'checkpoint',
      heading: 'mneia_checkpoint',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Records a batch of already-extracted items as one atomic checkpoint. Hand it the candidate decisions, constraints, open questions, facts, and artifact refs extracted from the session.',
            '**It does not read the transcript itself.** Extraction is the agent’s job, and the boundary is explicit for the same reason: ambient capture produces noise, and a batch a human can review produces a record worth trusting.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            'Candidates that are load-bearing are held in a pending queue rather than written.',
            'Candidates that supersede an existing item are held too.',
            'The pending queue must be surfaced to a human **verbatim** — summarising it is how the disagreement a person needed to settle gets erased.',
          ],
        },
      ],
    },
    {
      id: 'search',
      heading: 'mneia_search',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Looks up specific items by kind, status, load-bearing flag, and free text. Use it to check whether a constraint on a topic exists, to read what a decision said, or to find the id of the item you are about to supersede.',
            'Returns a compact list with full item ids and provenance — not a ranked slice. It competes for the same context window as a rehydration, so keep the limit small.',
          ],
        },
      ],
    },
    {
      id: 'errors',
      heading: 'How failures come back',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Arguments are validated before anything is read or written, so an invalid call changes nothing. Every failure carries a code, a summary of what went wrong, and a remedy stated in terms of what to do next.',
          ],
        },
        {
          kind: 'table',
          head: ['Code', 'Meaning'],
          rows: [
            ['`invalid_arguments`', 'The arguments did not validate. Nothing was read or written'],
            [
              '`tool_not_available`',
              'A real Mneia tool this server did not load, or one that ships in a later milestone',
            ],
            ['`unknown_tool`', 'Not a Mneia tool at all'],
            [
              '`tool_failed`',
              'A fault in the server. Retry once; then continue without it and report the failure rather than assuming the answer',
            ],
          ],
        },
        {
          kind: 'note',
          text: '`mneia_handoff_create` and `mneia_handoff_receive` ship in M2, and `mneia_conflicts` in M4. The server names the milestone rather than returning "unknown tool", so an agent can tell "not yet" from "wrong name" and stop retrying.',
        },
      ],
    },
  ],
};

export const DOC_PAGES: readonly DocPage[] = [QUICKSTART, CONCEPTS, CLI, MCP];

export function docPage(slug: DocSlug): DocPage {
  const page = DOC_PAGES.find((entry) => entry.slug === slug);
  if (!page) {
    throw new Error(`expected a doc page for "${slug}"; found none`);
  }
  return page;
}
