import type { DocPage } from './types';

export const CLI: DocPage = {
  slug: 'cli',
  name: 'CLI reference',
  title: 'CLI reference',
  description:
    'Every Mneia CLI command — init, login, whoami, brief, checkpoint, handoff, pickup, conflicts, log, and status — plus the interactive session, with flags, environment variables, JSON output, and exit codes.',
  eyebrow: 'Reference',
  heading: 'The mneia command, in full.',
  lead: 'The CLI is a thin surface over the same core the MCP server uses, so the two return the same answer for the same input. Every command takes --json and --help.',
  minutes: 10,
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
            ['`mneia brief "<task>"`', 'Print the rehydrated context slice for a stated task'],
            ['`mneia checkpoint`', 'Capture the session into project memory at a boundary'],
            ['`mneia handoff`', 'Produce a handoff artifact and print it with its link'],
            ['`mneia pickup`', 'Receive a handoff, print it, and mark it received'],
            ['`mneia conflicts`', 'List unresolved conflicts and resolve them interactively'],
            ['`mneia log`', 'Show the decision history for this project, newest first'],
            ['`mneia status`', 'Show what is stale, disputed, or unanswered in this project'],
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            'Running `mneia` with no arguments opens an interactive session over the same commands — see **the interactive session** below.',
          ],
        },
        {
          kind: 'note',
          text: 'There is no `sync`, and there will not be one. Every command is an authenticated API call against a single store, so there is nothing to reconcile — no watermarks, no clock skew, no offline write queue, and no local-versus-hosted parity to keep.',
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
            'Anything you type that does not begin with `/` is rehydrated as a task, because that is the thing you do most often. The commands are the same ones above, slash-prefixed and taking the same flags — `/status --json`, `/log --limit 5`, `/checkpoint -m "chose the token bucket"`.',
            'Tab completes a slash command, the up arrow walks your history, `/clear` clears the screen, and `/exit` or Ctrl+D leaves. Ctrl+C cancels the line you are typing; press it twice to leave. If the machine is not signed in, or the stored token has expired, the session runs the device flow for you rather than telling you to go and run **mneia login** first.',
          ],
        },
        {
          kind: 'note',
          text: '**Only a terminal gets the session.** Piped, redirected, or run in CI, bare `mneia` still prints the command list to stderr and exits `2` — so a script that depends on that behaviour keeps working. It dispatches commands and does not talk to a model; a prompt that answered questions would be a chat interface, which is deliberately not what this is.',
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
            '`login` runs a browser device flow. It prints a link, a user code, and a confirmation number; approve it in the browser — checking that the workspace named on that page is the one you expect — and the token is written to `~/.mneia/credentials` with `0600` permissions.',
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
      id: 'checkpoint',
      heading: 'mneia checkpoint',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: ['mneia checkpoint [-m "<summary>"] [--trigger <trigger>] [--json]'],
        },
        {
          kind: 'text',
          paragraphs: [
            'Captures what the session decided. `-m` attaches your own one-line summary, which is worth using when the session covered more than its commits suggest. `--trigger` records why the checkpoint ran — useful when a hook fires it rather than a person.',
            'This is the surface that asks you to confirm things, and it only asks about what genuinely needs a human: items that are load-bearing, and items that contradict something already recorded. Everything else is written without interrupting you.',
          ],
        },
        {
          kind: 'note',
          text: 'Checkpointing resumes from a server-side watermark, so a run that fails part way through does not lose the turns it had already read, and running it twice does not capture the same session twice.',
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
            'mneia handoff [--to <actor>] [--next "<action>"] [--json]',
            'mneia pickup [<id>] [--json]',
          ],
        },
        {
          kind: 'text',
          paragraphs: [
            '`handoff` renders the artifact for the current project and prints it along with the link to it. Naming `--to` directs it at one person; leaving it off makes an open handoff that anyone picking up the work can take.',
            '`pickup` receives one. With no id it takes the handoff addressed to you, or the most recent open one on this project; with an id it takes that one specifically. It prints the frozen artifact and marks it received, which is the point the pickup clock starts from.',
          ],
        },
      ],
    },
    {
      id: 'conflicts',
      heading: 'mneia conflicts',
      blocks: [
        {
          kind: 'code',
          label: 'usage',
          lines: ['mneia conflicts [--json]'],
        },
        {
          kind: 'text',
          paragraphs: [
            'Lists the unresolved disagreements on this project and walks them one at a time — both items side by side with full provenance, then the resolution and the reason for it.',
            'The reason is not optional. The outcome could be inferred from the rows afterwards; the reasoning could not, and it is the half that explains the decision to whoever reads it next year.',
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
            '`log` is the decision history, newest first — what was decided, by whom, and what it superseded. `--since` takes a duration such as `7d` or an absolute date, and supersede chains read as a sequence rather than a pile.',
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
              '`https://app.mneia.dev`',
              'The API endpoint. Wins over the value in `.mneia/config.json`',
            ],
            [
              '`MNEIA_TELEMETRY`',
              'on',
              'Set to `off`, `false`, `no`, `none`, or `0` to opt out entirely',
            ],
            [
              '`MNEIA_HOME`',
              '`~/.mneia`',
              'Absolute path to the directory holding the credentials and the local binding. The MCP server reads the same variable',
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
            'Nothing is colour-only. Meaning is carried in the text, so piped output stays intelligible and a terminal that does not do colour loses nothing.',
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
            'Separating 3, 4, and 5 is what lets a CI step retry a network failure and fail fast on a missing binding, instead of treating every non-zero exit as the same event. A developer whose wifi dropped is told that, rather than being told their token is invalid.',
          ],
        },
      ],
    },
  ],
};
