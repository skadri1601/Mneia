# @mneia/cli

The command line interface for [Mneia](https://mneia.dev) — shared project memory and handoff for
teams working with AI agents.

Your agent forgets between sessions. Your teammates never knew in the first place. Mneia captures
what a session decided, and gives the next session — or the next person — the part of it that
matters.

```
npx @mneia/cli init
```

## Install

```
npm install -g @mneia/cli     # or pnpm add -g @mneia/cli
```

Node 20.11 or newer. `npx @mneia/cli <command>` works without installing.

## Getting started

Mneia is a hosted service. Create a workspace at [app.mneia.dev](https://app.mneia.dev), then:

```
mneia login          # sign this machine in, via a browser device-code flow
mneia init           # attach this repo to a project and import its existing constraints
```

`login` prints a link to open, a user code, and a confirmation number. Approve it in the browser —
check the workspace named on that page is the one you expect — and the token is written to
`~/.mneia/credentials` with `0600` permissions. `init` writes `.mneia/config.json` in the repo,
naming the workspace and project this directory is bound to. Commit that file; it holds no secret.

Confirm it worked:

```
$ mneia whoami
actor      Ada Lovelace <ada@example.com>
workspace  example-co
team       platform
endpoint   https://app.mneia.dev
```

If that prints instead of an error, the machine is signed in and everything else is an authenticated
call.

`init` also reads the constraints already written in your `AGENTS.md` and imports them, so the first
rehydration is not empty.

## Commands

| Command | What it does |
|---|---|
| `mneia init [--workspace <slug>] [--project <slug>] [--endpoint <url>] [--force]` | Attach this repo to a Mneia project and import its existing constraints. |
| `mneia login` | Sign this machine in to a Mneia workspace. |
| `mneia whoami` | Show the actor, workspace, and team this machine is signed in as. |
| `mneia checkpoint [-m "<summary>"] [--trigger <trigger>]` | Record what this session decided, confirming only what needs a human. |
| `mneia brief "<task>" [--budget <tokens>]` | Print the rehydrated context slice for a stated task. |
| `mneia log [--limit <count>] [--since <duration\|date>]` | Show the decision history for this project, newest first. |
| `mneia status` | Show what is stale, disputed, or unanswered in this project. |
| `mneia handoff [--to <actor-id>] [--window <days>]` | Freeze a receivable handoff artifact for whoever picks the work up next. |
| `mneia pickup [<handoff-id>]` | Receive a handoff, or list the open ones when no id is given. |

`--help` on any command prints its full usage. `--json` makes the output machine-readable. `mneia
--version` prints the version.

`conflicts` is named but not yet shipped; running it tells you which release it lands in rather than
failing with an unknown-command error.

## The interactive session

Run `mneia` with no arguments in a terminal and it opens a session instead of exiting:

```
$ mneia

  █▄   ▄█   mneia  v0.7.1
  █ ▀▄▀ █   Ada Lovelace · example-co
  █     █   ~/code/api  ·  api

  /help for commands · /exit to leave

› add rate limiting to the public API
```

Anything you type that does not start with `/` is rehydrated as a task, because that is the thing
you do most. Commands are the same nine, prefixed with a slash and taking the same flags —
`/status --json`, `/log --limit 5`, `/checkpoint -m "chose the token bucket"`.

Typing `/` opens a menu of every command, and each further character narrows it. The arrow keys move
the selection, Tab or the right arrow accepts it, and Escape dismisses it; the rest of the selected
name is shown after the cursor so there is nothing to memorise. Enter runs the selected command, or
leaves the cursor after it when the command still needs an argument.

The up arrow walks your history, which is kept in `~/.mneia/history` and survives the session.
Ctrl+L clears the screen without losing the line you are typing, and Ctrl+A, Ctrl+E, Ctrl+U, Ctrl+K
and Ctrl+W work as they do in a shell. `/exit` or Ctrl+D leaves; Ctrl+C cancels the line you are
typing, and twice in a row leaves.

If the machine is not signed in, or the stored token has expired, the session runs the device flow
for you rather than telling you to go and run `mneia login` first.

**Only a terminal gets the session.** Piped, redirected, or run in CI, bare `mneia` still prints
the command list and exits `2`, so a script that depends on that keeps working.

## A session

```
mneia brief "add rate limiting to the public API"
```

Prints the minimal high-signal slice for that task under a token budget: the decisions that bear on
it, the constraints that are still active, the open questions — and what was already tried and
rejected, so the agent does not propose it again. Load-bearing constraints are always included,
whatever the budget pressure.

```
mneia checkpoint -m "chose the token bucket over a sliding window"
```

Captures the session into a typed schema. Anything that contradicts what the project already
believes is surfaced for a human to settle. An agent never silently overwrites something a human
confirmed.

## Configuration

| Variable | Purpose |
|---|---|
| `MNEIA_TOKEN` | API token. Set it in CI instead of running `mneia login`. Takes precedence over `~/.mneia/credentials`. |
| `MNEIA_API_URL` | API base URL. Defaults to `https://app.mneia.dev`. |
| `MNEIA_AUTH_URL` | Where `mneia login` sends you to approve a device code. Defaults to `https://app.mneia.dev`. |
| `MNEIA_HOME` | Absolute path to the directory holding the credentials and the local binding. Defaults to `~/.mneia`. `@mneia/mcp-server` honours it too, so a login written under it is found by the server. |
| `MNEIA_CREDENTIALS_PATH` | Absolute path to the credentials file, instead of `<MNEIA_HOME>/credentials`. |

Every command is an authenticated API call against your workspace. There is no sync step and no
local replica to reconcile.

## Privacy

Mneia is hosted. Your context is stored in the service, and access to it is enforced by controls —
workspace scope on every row, Postgres row-level security, retention, and residency — not by where
the bytes happen to sit. Usage events carry ids and timings, never your content.

Read the [privacy policy](https://mneia.dev/privacy) for what is kept and for how long.

## Stability

`0.x`. The command surface will move before `1.0` — pin an exact version in CI if a change to the
output shape would break you.

## See also

- [`@mneia/mcp-server`](https://www.npmjs.com/package/@mneia/mcp-server) — the same operations as MCP
  tools, for Claude Code, Cursor, Codex, and any MCP client
- [`@mneia/core`](https://www.npmjs.com/package/@mneia/core) — the library underneath both

Apache-2.0.
