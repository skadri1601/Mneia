import type { DocPage } from './types';

export const QUICKSTART: DocPage = {
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
            'You need a Mneia account and Node.js 20.11 or newer. Sign up at app.mneia.dev, or accept an invitation from a colleague — accepting one puts you in their workspace rather than a new one of your own.',
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
            'Let the Mneia CLI detect the MCP clients on this machine and register the server in each client’s native format:',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: ['mneia mcp install', 'mneia mcp list'],
        },
        {
          kind: 'text',
          paragraphs: [
            'To target one client, run **mneia mcp install --client codex --yes** and replace `codex` with the client you selected. The complete client tabs, copyable agent prompts, native fallbacks, and verification steps are at **/docs/integrations#mcp-clients**.',
            'The server reads the same credentials file written by **mneia login**. The project binding comes from `.mneia/config.json` in the working directory, so the agent inherits it without being told. Restart a client that was already open, then verify setup by asking it to call `mneia_rehydrate`.',
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
        {
          kind: 'text',
          paragraphs: [
            'Or run **mneia** with no arguments and stay in the session, where a bare line is the task to rehydrate and the commands are slash-prefixed:',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: [
            '$ mneia',
            '',
            '  █▄   ▄█   mneia  v0.4.0',
            '  █ ▀▄▀ █   Ada Lovelace · example-co',
            '  █     █   ~/code/payments  ·  payments',
            '',
            '  /help for commands · /exit to leave',
            '',
            '› migrate the ledger writes to the v2 schema',
            '',
            '# ... work ...',
            '',
            '› /checkpoint -m "kept the writes idempotent under retry"',
            '› /status',
          ],
        },
      ],
    },
    {
      id: 'next',
      heading: '6. Where to go next',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'The quickstart covers one person and one repository. The rest of the documentation covers the system.',
          ],
        },
        {
          kind: 'bullets',
          items: [
            '**Concepts** is the vocabulary — item kinds, provenance, superseding, and why a rejected approach is kept rather than deleted. Read it before the reference pages.',
            '**Checkpoint**, **Rehydrate**, and **Handoff** are the three operations in depth. Everything Mneia does is one of them.',
            '**Conflict resolution** is what happens when two sources disagree, and the rules are not symmetrical.',
            '**Workspaces, teams, and scope** covers the second person, the second team, and who can see what.',
            '**CLI** and **MCP server** are the exact commands, tools, flags, and exit codes.',
            '**Data model** is the schema underneath all of it, and **Security and privacy** is how it is isolated, retained, and audited.',
          ],
        },
        {
          kind: 'note',
          text: 'Everything in these pages is one of three verbs — checkpoint, rehydrate, handoff — plus conflict arbitration when two of them collide. If something you want does not map onto one of those, it is probably deliberately outside the product.',
        },
      ],
    },
  ],
};
