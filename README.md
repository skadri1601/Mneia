# Mneia

**Your agent forgets. Your teammates never knew.**

Mneia is the shared project memory and handoff layer for teams working with AI agents. It captures
what a session decided, and gives the next session — or the next person — the part of it that
matters.

```bash
mneia login                                    # once per machine
mneia brief "add rate limiting to the API"     # what this task needs to know
mneia checkpoint -m "chose the token bucket"   # what this session decided
```

---

## The problem

You spend three hours with Claude Code on Monday establishing twenty decisions — why Postgres over
DynamoDB, which auth pattern, what broke when you tried the obvious thing. Tuesday you open a new
session and the agent knows none of it.

Worse: mid-session, auto-compaction fires and the agent silently loses a constraint you set two hours
ago, then confidently proposes the approach you already rejected.

Worse still: a teammate picks up the work. The decisions live in a transcript that was compacted
away, or in one person's head.

## Three operations

Everything else exists to serve these.

| | |
|---|---|
| **Checkpoint** | At a task or day boundary, capture the decisions, constraints, and open questions from the session into a typed schema. Contradictions with what you already believe are surfaced for a human to settle, never silently overwritten. |
| **Rehydrate** | Given the next task and a token budget, assemble the minimal high-signal slice. Load-bearing constraints are always included, whatever the budget pressure. |
| **Handoff** | Produce a receivable artifact when work changes hands: what's done, current state, open questions, constraints, the next concrete action — and what was already tried and rejected. |

## Why not just a memory store

Every alternative gives you somewhere to *put* context and a way to *query* it. But querying requires
knowing what to ask, and the defining condition of picking up work is not knowing what you don't
know.

Nobody types *"what approaches did we already reject?"* — yet it is the most valuable thing to learn
when resuming. Mneia pushes the context you would not have thought to pull.

The category around us optimises single-agent recall. The unit of value here is not memory, it is the
**handoff**: work stops with one actor and resumes with another. That forces provenance, conflict
resolution, and permissions — which a single-user memory product cannot bolt on afterwards.

## Status

**M1 (Core Loop) is the active milestone, and it ends 1 September 2026.** Last verified 2026-08-17.

| | |
|---|---|
| Hosted API | Live at `app.mneia.dev` — checkpoints, rehydrate, items, projects, sessions, actors |
| CLI | `init` `login` `whoami` `status` `log` `checkpoint` `brief` `handoff` `pickup`, plus an interactive session when run bare in a terminal |
| MCP tools | `mneia_rehydrate` `mneia_checkpoint` `mneia_search` `mneia_assert` `mneia_retire` `mneia_handoff_create` `mneia_handoff_receive` |
| Auth | Browser device flow; `MNEIA_TOKEN` for CI |
| Tenancy | `workspace_id` on every row, Postgres row-level security enforced and asserted at connection time |
| Workspaces | Invite a colleague by email; they land in the inviting workspace |
| **npm** | **Published.** `@mneia/cli`, `@mneia/mcp-server`, and `@mneia/core` are live at `0.7.1`. |
| Billing | Code complete, **not switched on** — `/api/health` reports `billing: not_configured` and nothing is charged |

`handoff` and `pickup` have since shipped. `conflicts` is still named but not shipped — running it
names the milestone it lands in rather than failing as an unknown command.

For the reasoning behind any of it, read [`vision.md`](./vision.md); for the plan,
[`ROADMAP.md`](./ROADMAP.md).

## Packages

| Package | What it is | Licence |
|---|---|---|
| [`@mneia/cli`](./packages/cli) | The `mneia` command line interface | Apache 2.0 |
| [`@mneia/mcp-server`](./packages/mcp-server) | MCP server for Claude Code, Cursor, Codex, and any MCP client | Apache 2.0 |
| [`@mneia/core`](./packages/core) | Data model, rehydration, supersede policy, store adapter, telemetry | Apache 2.0 |
| `apps/web` | The hosted control plane | Proprietary |
| `apps/site` | The marketing site and documentation | Proprietary |

Dependency direction is one-way: `cli` and `mcp-server` both depend on `core`, and `core` imports
neither.

## How it runs

Mneia is a **hosted service**. The CLI and MCP server are clients — they authenticate and talk to the
API. There is no local database to install or operate, and no sync step to reconcile.

```bash
mneia login          # device flow, once per machine
mneia init           # bind this repo to a project, import constraints from AGENTS.md
```

In CI, set `MNEIA_TOKEN` instead of logging in. The surface is otherwise identical, which makes an
ephemeral runner a first-class client rather than a special case.

Run `mneia` with no arguments in a terminal and it opens an interactive session rather than exiting.
Anything not starting with `/` is rehydrated as a task; the commands are the same ones, slash-prefixed
and taking the same flags. Off a TTY — piped, redirected, or in CI — bare `mneia` still prints the
command list and exits `2`, so scripts depending on that keep working.

Step by step, including per-client MCP configuration: [`docs/INSTALL.md`](./docs/INSTALL.md). Which
clients have actually been verified, and how far each check reached:
[`docs/CLIENTS.md`](./docs/CLIENTS.md).

## Development

Node 20.11+ and pnpm 9+. Copy `.env.example` to `.env` and put a Postgres connection string in
`DATABASE_URL` — use the direct one, not the `-pooler` endpoint.

```bash
pnpm install
pnpm -r build         # every workspace member, including both Next apps
pnpm test             # builds first, then vitest
pnpm lint             # biome
```

`pnpm test` needs `DATABASE_URL`; without one the Postgres integration suites skip themselves and
prove nothing. A local engine works:

```bash
docker run -d --name mneia-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mneia \
  -p 5433:5432 pgvector/pgvector:pg18
DATABASE_URL='postgres://postgres:postgres@localhost:5433/mneia' pnpm test
```

Bare `pnpm build` only typechecks the three packages — it will go green on a branch with type errors
in `apps/web`. Use `pnpm -r build`.

Schema changes: write the migration, run `pnpm db:snapshot`, and commit `db/structure.sql` in the
same commit. CI fails the PR otherwise.

Contributor guidance lives in [`AGENTS.md`](./AGENTS.md) — it is written for coding agents, and it is
the fastest orientation for a human too.

## Licence

**The client packages are Apache 2.0** — see [LICENSE](./LICENSE). That covers `@mneia/cli`,
`@mneia/mcp-server`, and `@mneia/core`: the schema, the handoff format, the extraction prompts, and
the ranking algorithm. The parts that carry our judgement are inspectable and forkable.

**The server is proprietary**, and the clients require an account to function. We do not claim to be
self-hostable, and we do not claim your content stays on your machine — it does not. Privacy here is
enforced by controls: workspace scope on every row, row-level security, retention, and residency.

Read the [privacy policy](https://mneia.dev/privacy) for what is kept and for how long.
