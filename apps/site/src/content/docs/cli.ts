import type { DocPage } from './types';

export const CLI: DocPage = {
  slug: 'cli',
  name: 'CLI reference',
  title: 'CLI reference',
  description:
    'Every Mneia CLI command - init, login, whoami, brief, checkpoint, review, verify, handoff, pickup, team, sessions, log, status, and mcp - plus the interactive session, with flags, environment variables, JSON output, and exit codes.',
  eyebrow: 'Reference',
  heading: 'The mneia command, in full.',
  lead: 'The CLI is a thin surface over the same core the MCP server uses, so the two return the same answer for the same input. Every command takes --json and --help.',
  minutes: 14,
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
            ['`mneia login`', 'Sign this machine in to a workspace, through a browser device flow'],
            [
              '`mneia whoami`',
              'Show the actor, workspace, team, and endpoint this machine is signed in as',
            ],
            ['`mneia mcp`', 'Install, list, and remove the Mneia MCP server in your MCP clients'],
            ['`mneia brief "<task>"`', 'Print the rehydrated context slice for a stated task'],
            ['`mneia checkpoint`', 'Capture the session into project memory at a boundary'],
            [
              '`mneia review`',
              'Read the human-confirmation queue, and drain it one keypress at a time',
            ],
            [
              '`mneia verify`',
              'List the items due for re-verification, and confirm or retire one of them',
            ],
            [
              '`mneia handoff "<next action>"`',
              'Produce a handoff artifact and print it with its link',
            ],
            ['`mneia pickup`', 'Receive a handoff, print it, and mark it received'],
            [
              '`mneia team`',
              'List the people and agents in this workspace, with the ids a handoff can address',
            ],
            [
              '`mneia sessions`',
              'Show who has worked on this project, from which client, and what it produced',
            ],
            ['`mneia log`', 'Show the decision history for this project, newest first'],
            ['`mneia status`', 'Show what is stale, disputed, or unanswered in this project'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Running `mneia` with no arguments opens an interactive session over the same commands - see **the interactive session** below.',
            'That table is the whole surface. The binary rejects a command registered outside it rather than shipping one ahead of its milestone, so a command missing here is a command this build genuinely does not have.',
          ],
        },
        {
          kind: 'table',
          head: ['Not a command', 'What happens instead'],
          rows: [
            [
              '`mneia conflicts`',
              'Refused with **conflicts ships in M4**. Conflict resolution exists in the schema and in the web app; the terminal surface for it is not built. Read `/docs/conflicts` for the rules it will follow',
            ],
            [
              '`mneia sync`',
              'Refused with **there is no sync - every mneia command is an authenticated API call**',
            ],
          ],
        },
        {
          kind: 'note',
          text: 'There is no `sync`, and there will not be one. Every command is an authenticated API call against a single store, so there is nothing to reconcile - no watermarks, no clock skew, no offline write queue, and no local-versus-hosted parity to keep.',
        },
      ],
    },
    {
      id: 'session',
      heading: 'The interactive session',
      blocks: [
        {
          kind: 'text',
          paragraphs: [
            'Run **mneia** with no arguments in a terminal and it opens a session instead of printing usage and exiting.',
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
            '  █     █   ~/code/api  ·  api',
            '',
            '  /help for commands · /exit to leave',
            '',
            '› add rate limiting to the public API',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Anything you type that does not begin with `/` is rehydrated as a task, because that is the thing you do most often. The commands are the same ones above, slash-prefixed and taking the same flags - `/status --json`, `/log --limit 5`, `/checkpoint -m "chose the token bucket"`.',
            'Tab completes a slash command, the up arrow walks your history, `/clear` clears the screen, and `/exit` or Ctrl+D leaves. Ctrl+C cancels the line you are typing; press it twice to leave. If the machine is not signed in, or the stored token has expired, the session runs the device flow for you rather than telling you to go and run **mneia login** first.',
          ],
        },
        {
          kind: 'note',
          text: '**Only a terminal gets the session.** Piped, redirected, or run in CI, bare `mneia` still prints the command list to stderr and exits `2` - so a script that depends on that behaviour keeps working. It dispatches commands and does not talk to a model; a prompt that answered questions would be a chat interface, which is deliberately not what this is.',
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
      id: 'auth',
      heading: 'mneia login and mneia whoami',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: ['mneia login [--json]', 'mneia whoami [--json]'],
        },
        {
          kind: 'text',
          paragraphs: [
            '`login` runs a browser device flow. It prints a link, a user code, and a confirmation number; approve it in the browser - checking that the workspace named on that page is the one you expect - and the token is written to `~/.mneia/credentials` with `0600` permissions.',
            '`whoami` is how you confirm it worked, and the first thing worth running when something behaves unexpectedly. It prints the actor, workspace, team, and endpoint this machine is signed in as.',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: [
            '$ mneia whoami',
            'actor      Ada Lovelace <ada@example.com>',
            'workspace  example-co',
            'team       platform',
            'endpoint   https://app.mneia.dev',
          ],
        },
        {
          kind: 'note',
          text: 'In CI, set `MNEIA_TOKEN` rather than running `login`. The rest of the surface is identical, which is what makes an ephemeral runner an ordinary client rather than a special case. A token carries its workspace, so there is no workspace flag to pass.',
        },
        {
          kind: 'text',
          paragraphs: [
            'An application connecting from somewhere that is not your machine - a hosted agent, a directory-listed connector - authenticates through OAuth instead of the device flow. See **/docs/oauth**.',
          ],
        },
      ],
    },
    {
      id: 'mcp',
      heading: 'mneia mcp',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: [
            'mneia mcp <install|list|uninstall> [--client <client> | --all] [--yes] [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'This is the command every install guide points at. It writes the Mneia MCP server into your MCP clients native configuration files, so you do not hand-edit JSON in seven different places and get one of them subtly wrong.',
            'The entry it writes is deliberately minimal: the command `mneia-mcp`, no arguments, and no environment. The server reads its own credentials from `~/.mneia/credentials` and its project binding from `.mneia/config.json`, so a config carrying a token would be a second copy of a secret with nothing to keep it in step.',
          ],
        },
        {
          kind: 'table',
          head: ['Subcommand', 'What it does'],
          rows: [
            [
              '`mneia mcp install`',
              'Write the `mneia` server entry into each selected client. A client that already has the canonical entry is reported as unchanged rather than rewritten',
            ],
            [
              '`mneia mcp list`',
              'Print which of the selected clients currently carry a `mneia` entry, and the config file each one lives in. Reads only',
            ],
            [
              '`mneia mcp uninstall`',
              'Remove the `mneia` entry. Requires `--yes`, because it edits a file you did not write in this command',
            ],
          ],
        },
        {
          kind: 'table',
          head: ['Flag', 'Effect'],
          rows: [
            [
              '`--client <client>`',
              'Target one client explicitly. Repeat the flag, or pass a comma-separated list, to name several',
            ],
            ['`--all`', 'Target every supported client. Cannot be combined with `--client`'],
            [
              '`--yes`',
              'Proceed without asking when the client already holds different `mneia` configuration, or could not be inspected. Required by `uninstall`, rejected by `list`',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'With neither `--client` nor `--all`, install and uninstall **detect** the clients installed on the machine and ask you which of them to configure. That prompt needs a terminal: off a TTY the command stops and tells you to pass `--client`, or `--all --yes`, rather than silently choosing for you.',
            'The supported clients come from the installer library rather than from a list Mneia maintains, and today they are `antigravity`, `claude-code`, `claude-desktop`, `cline`, `cline-cli`, `codex`, `cursor`, `gemini-cli`, `github-copilot-cli`, `goose`, `grok-build`, `mcporter`, `opencode`, `vscode`, `windsurf`, and `zed`. Run `mneia mcp install --help` for the list this build actually supports.',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: [
            '# let it detect what is installed and ask',
            '$ mneia mcp install',
            'Detected claude-code, cursor. Which clients should MNEIA configure? claude-code',
            'Configured MNEIA for claude-code.',
            '',
            '# or name one and do not ask',
            '$ mneia mcp install --client codex --yes',
            '',
            '# what is configured now',
            '$ mneia mcp list',
            'claude-code: /home/ada/.claude.json',
          ],
        },
        {
          kind: 'note',
          text: 'Installing a client config is not the same as the server working. Sign in first with **mneia login**, and bind the repository with **mneia init**, or the server will refuse to start and say which of the two is missing. See **/docs/integrations#mcp-clients** for the per-client setup, and **/docs/mcp** for the tools it then exposes.',
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
            'The terminal-side rehydration. State the task in the words you would use to a colleague - the slice is chosen for that task, so "fix the ledger rounding bug" and "migrate the ledger schema" return different context from the same project.',
            '`--budget` caps the slice in tokens. Load-bearing active constraints are included regardless of what you set it to.',
          ],
        },
      ],
    },
    {
      id: 'checkpoint',
      heading: 'mneia checkpoint',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: [
            'mneia checkpoint [-m "<summary>"] [--trigger <trigger>]',
            '                 [--session <ref> [--source <harness>] | --all-sessions] [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Captures what the session decided. `-m` attaches your own one-line summary, which is worth using when the session covered more than its commits suggest. `--trigger` records why the checkpoint ran - useful when a hook fires it rather than a person.',
            'With no session flags it checkpoints **the single most recently active session** for this directory, and says on stderr how many others it found and did not read. `--all-sessions` sweeps every session it discovered instead; `--session <ref>` names one, with `--source <harness>` to disambiguate a reference that two harnesses both use.',
            'This is the surface that asks you to confirm things, and it only asks about what genuinely needs a human: items that are load-bearing, and items that contradict something already recorded. Everything else is written without interrupting you.',
          ],
        },
        {
          kind: 'note',
          text: 'Checkpointing resumes from a server-side watermark, so a run that fails part way through does not lose the turns it had already read, and running it twice does not capture the same session twice. Each session carries its own watermark, so one you did not read today resumes where it was when you do.',
        },
        {
          kind: 'text',
          paragraphs: [
            'Anything the checkpoint held back for a person lands in the review queue - **mneia review**, below.',
          ],
        },
      ],
    },
    {
      id: 'review',
      heading: 'mneia review',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: ['mneia review [--drain] [--limit <count>] [--json]'],
        },
        {
          kind: 'text',
          paragraphs: [
            'The human-confirmation queue, from the terminal. An item an agent asserted that no person has confirmed does not count as settled - it waits here. Load-bearing items always wait; so does anything that would overrule a human-confirmed item.',
            'With no flags it **reads** the queue and writes nothing: load-bearing items first, then oldest first, with the provenance of each and a short preview of its body. `--limit` caps the read at a number of items, defaulting to 20 and capped at 100 - the queue is meant to be drained rather than paged through.',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`--drain` walks it one item at a time and asks about each. Confirm is one keypress, and editing does not make you retype the item.',
          ],
        },
        {
          kind: 'table',
          head: ['Key', 'What it does'],
          rows: [
            ['`y`', 'Confirm the item as it stands'],
            [
              '`e`',
              'Edit it first - `t` for the title, `b` for the body, `l` to toggle load-bearing, `d` when you are done. An edit that changed nothing is recorded as a plain confirmation',
            ],
            [
              '`r`',
              'Reject it. **A reason is required** and it will keep asking until you give one - the reason is the half of the decision the rows could not have reproduced',
            ],
            ['`s`', 'Leave it pending. It stays in the queue exactly as it was'],
            ['`?`', 'Explain why this particular item is being asked about'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Nothing is written until the whole queue has been walked, and then it goes in one call: the API records the confirmations, edits, and rejections and emits their events, so a terminal reviewer and a web reviewer leave the same record. Cancel part way through and nothing is written at all. Leave everything pending and nothing is written either, and the command says so.',
          ],
        },
        {
          kind: 'note',
          text: '**There is no `--confirm`, `--accept`, `--yes`, or `--all`.** Passing one is a usage error with that explanation, because a confirmation is a keypress by a person and never a flag. `--drain` also refuses to run off a TTY, and refuses to combine with `--json` - to read the queue from a script, run `mneia review --json`, which writes nothing.',
        },
        {
          kind: 'text',
          paragraphs: [
            'A **disputed** item never appears here. The queue lists active items, and a disagreement between two people is left to the people involved rather than settled by whichever of them happened to run the command.',
            'The same queue is readable from an agent through `mneia_review_queue`, and from the web app. An MCP tool cannot block and ask, so that tool reads and never writes.',
          ],
        },
      ],
    },
    {
      id: 'verify',
      heading: 'mneia verify',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: [
            'mneia verify [<id> --confirm | <id> --deny --reason "<why>"] [--limit <count>] [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Freshness, rather than correctness at the moment of capture. An item can carry a decay window, and once that window has passed the item is **due for re-verification** - still active, but nobody has said recently that it still holds.',
            'With no arguments, `verify` lists what is due, oldest first, each with who asserted it, when it was last verified, and how long it has been overdue. `--limit` caps the list at a number of items, defaulting to 20 and capped at 200.',
          ],
        },
        {
          kind: 'table',
          head: ['Flag', 'Effect'],
          rows: [
            [
              '`<id>`',
              'The item to decide on. At least four characters of the id, as printed in [brackets], or a full uuid. An ambiguous prefix is refused rather than guessed at',
            ],
            [
              '`--confirm`',
              'The item still holds. Its verification time moves to now and its next due date is recomputed from its decay window',
            ],
            [
              '`--deny --reason "<why>"`',
              'It no longer holds, so retire it. The reason is required, and it is what the record keeps',
            ],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Both decisions are recorded as a checkpoint, so the change is attributable in exactly the way every other write is. A denied item is **retired, not deleted** - it stays in the record so the history still reads.',
          ],
        },
        {
          kind: 'note',
          text: '**Constraints never appear here.** Their decay window is null on purpose: a constraint does not go stale on a timer, and asking about one every fortnight would train people to press confirm without reading. A **disputed** item is refused too, with the reason stated - one side answering a re-verification prompt is not how a disagreement between two people gets settled.',
        },
      ],
    },
    {
      id: 'handoff-pickup',
      heading: 'mneia handoff and mneia pickup',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: [
            'mneia handoff "<next action>" [--to <name|email|id>] [--window <days>] [--json]',
            'mneia pickup [<handoff-id>] [--read] [--limit <count>] [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`handoff` renders the artifact for the current project and prints it along with the link to it. The next action is the argument, because a handoff with no next action is a status update. Naming `--to` directs it at one person; leaving it off makes an open handoff that anyone picking up the work can take. `--window` sets how far back the recently-superseded section reaches.',
            '`--to` takes a name, an email, or an id, and resolves it against the workspace roster - run **mneia team** to see what it will accept. A reference matching more than one person is refused with the candidates listed, because a directed handoff goes to exactly one of them.',
            '`pickup` receives one. With no id it takes the handoff addressed to you, or the most recent open one on this project; with an id it takes that one specifically. It prints the frozen artifact and marks it received, which is the point the pickup clock starts from. `--read` prints without marking it received.',
          ],
        },
      ],
    },
    {
      id: 'team-sessions',
      heading: 'mneia team and mneia sessions',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: [
            'mneia team [--limit <count>] [--json]',
            'mneia sessions [--limit <count>] [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`team` lists the actors in this workspace - people and agents both - humans first and then alphabetically, each with the short id that `mneia handoff --to` accepts. It marks which one is you, and shows the email or external reference where there is one. `--limit` defaults to 200 and is capped at 500.',
            '`sessions` answers a different question: who has worked on **this project**, newest first. Each entry carries the window it ran for, the actor, the client and version it came from, the client session reference where the harness exposes one, and what the session produced in checkpoints and context items.',
          ],
        },
        {
          kind: 'code',
          label: 'shell',
          lines: [
            '$ mneia team',
            'example-co — 4 actors in this workspace, humans first',
            '2 humans · 2 agents · limit 200',
            '',
            '  [3f9c]  Ada Lovelace       human · you · ada@example.com',
            '  [a10b]  Grace Hopper       human · grace@example.com',
            '  [7d42]  claude-code        agent',
            '  [c8e1]  codex              agent',
            '',
            'Address a handoff with: mneia handoff "<next action>" --to a10b',
          ],
        },
        {
          kind: 'note',
          text: 'Both are **read-only**. Neither creates an actor, sends an invitation, nor changes a role - membership is managed in the web app. They exist because a directed handoff is unusable without a way to name the recipient, and because knowing who has been here before you is the first question when you pick work up.',
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
            'mneia log [--limit <count>] [--since <duration|date>] [--chain <id>] [--json]',
            'mneia status [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`log` is the decision history, newest first - what was decided, by whom, and what it superseded. `--since` takes a duration such as `7d` or an absolute date, and `--chain <id>` follows one item through every version of itself, so a supersede chain reads as a sequence rather than a pile.',
            '`status` is the health of the project rather than its history: what is stale, what is disputed, and which open questions have been sitting unanswered. It also prints where this workspace sits against its allowance for the period - see **/docs/metering**. It is the command worth running before a planning meeting.',
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
              '-',
              'The auth token. Wins over the credentials file; required in CI',
            ],
            [
              '`MNEIA_API_URL`',
              '`https://app.mneia.dev`',
              'The API endpoint. Wins over the value in `.mneia/config.json`',
            ],
            [
              '`MNEIA_HOME`',
              '`~/.mneia`',
              'Absolute path to the directory holding the credentials and the local binding. The MCP server reads the same variable',
            ],
            [
              '`MNEIA_CREDENTIALS_PATH`',
              '`~/.mneia/credentials`',
              'Absolute path to the credentials file. Wins over `MNEIA_HOME`',
            ],
            ['`MNEIA_DEBUG`', '-', 'Set to `1` to print the underlying stack trace on failure'],
          ],
        },
        {
          kind: 'note',
          text: '**`MNEIA_TELEMETRY` is not one of these.** The CLI emits no telemetry of its own - it holds a no-op emitter, so there is nothing for the variable to switch off here. It is read by the **MCP server** and by the core library; set it in the environment of those. See **/docs/mcp#environment** and **/docs/security#telemetry**.',
        },
        {
          kind: 'text',
          paragraphs: [
            'The §17 events for a write the CLI made are emitted by the API, on the server side, because that is where the write happens. Opting out of `MNEIA_TELEMETRY` on a client does not and could not suppress the record of a write that reached the store - what it governs is what a client transmits about itself.',
          ],
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
            'Every command takes `--json`, and the JSON is the contract - human output may be reformatted, the JSON shape may not. Errors carry a kind, a message naming what was expected and what was received, and a fix.',
            'Nothing is colour-only. Meaning is carried in the text, so piped output stays intelligible and a terminal that does not do colour loses nothing.',
          ],
        },
        {
          kind: 'table',
          head: ['Code', 'Meaning'],
          rows: [
            ['`0`', 'Success'],
            ['`1`', 'Failed - the operation was understood and did not succeed'],
            ['`2`', 'Usage - the invocation was wrong. Nothing was read or written'],
            ['`3`', 'Not configured - no `.mneia/config.json` for this directory'],
            ['`4`', 'Auth - no usable token'],
            ['`5`', 'Network - the API could not be reached. Your token was not the problem'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Separating 3, 4, and 5 is what lets a CI step retry a network failure and fail fast on a missing binding, instead of treating every non-zero exit as the same event. A developer whose wifi dropped is told that, rather than being told their token is invalid.',
          ],
        },
      ],
    },
  ],
};
