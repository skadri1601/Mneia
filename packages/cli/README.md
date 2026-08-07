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

`--help` on any command prints its full usage. `--json` makes the output machine-readable. `mneia
--version` prints the version.

`handoff`, `pickup`, and `conflicts` are named but not yet shipped; running one tells you which
release it lands in rather than failing with an unknown-command error.

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
| `MNEIA_CREDENTIALS_PATH` | Absolute path to the credentials file, instead of `~/.mneia/credentials`. |

Every command is an authenticated API call against your workspace. There is no sync step and no
local replica to reconcile.

## Privacy

Mneia is hosted. Your context is stored in the service, and access to it is enforced by controls —
workspace scope on every row, Postgres row-level security, retention, and residency — not by where
the bytes happen to sit. Usage events carry ids and timings, never your content.

Read the [privacy policy](https://mneia.dev/privacy) for what is kept and for how long.

## See also

- [`@mneia/mcp-server`](https://www.npmjs.com/package/@mneia/mcp-server) — the same operations as MCP
  tools, for Claude Code, Cursor, Codex, and any MCP client
- [`@mneia/core`](https://www.npmjs.com/package/@mneia/core) — the library underneath both

Apache-2.0.
