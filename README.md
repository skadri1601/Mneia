# Mneia

**Your agent forgets. Your teammates never knew.**

You spend three hours with Claude Code on Monday establishing twenty decisions — why Postgres over
DynamoDB, which auth pattern, what broke when you tried the obvious thing. Tuesday you open a new
session and the agent knows none of it.

Worse: mid-session, auto-compaction fires and the agent silently loses a constraint you set two hours
ago, then confidently proposes the approach you already rejected.

Worse still: a teammate picks up the work. The decisions live in a transcript that was compacted
away, or in one person's head.

Mneia is the shared project memory and handoff layer for teams working with AI agents.

---

## What it does

Three operations, and everything else exists to serve them.

**Checkpoint** — at a task or day boundary, capture the decisions, constraints, and open questions
from the session into a typed schema. Contradictions with what you already believe get surfaced for a
human to settle, not silently overwritten.

**Rehydrate** — given the next task and a token budget, assemble the minimal high-signal slice. Not
replay-everything, not raw semantic search. Load-bearing constraints are always included, because a
dropped constraint is exactly how the agent redoes the rejected approach.

**Handoff** — produce a receivable artifact when work changes hands: what's done, current state, open
questions, constraints, the next concrete action, and — the part nobody else ships — **what was
already tried and rejected**, so it doesn't get proposed again.

## Why not just a memory store

Every alternative gives you somewhere to *put* context and a way to *query* it. But querying requires
knowing what to ask, and the defining condition of picking up work is not knowing what you don't
know.

Nobody types *"what approaches did we already reject?"* — yet it's the most valuable thing to learn
when resuming. Mneia pushes the context you would not have thought to pull.

## Status

**Pre-code, under active construction.** M0 (foundations) is in progress. Nothing is installable yet.

- [`vision.md`](./vision.md) — the founding brief, and the reasoning behind every decision here
- [`ROADMAP.md`](./ROADMAP.md) — milestones and the full checklist

## Development

Requires Node 20.11+ and pnpm 9+.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
```

## Packages

| Package | What it is |
|---|---|
| `@mneia/core` | Data model, checkpoint, rehydration, handoff, telemetry |
| `@mneia/cli` | The `mneia` command line interface |
| `@mneia/mcp-server` | MCP server for Claude Code, Cursor, Codex, and any MCP client |

## How it runs

Mneia is a **hosted service**. The CLI and MCP server are clients — they authenticate and talk to the
API; there is no local database to install or operate.

```bash
mneia login          # device flow, once
mneia checkpoint     # everything else is an authenticated call
```

In CI, set `MNEIA_TOKEN` instead of logging in. The surface is otherwise identical, which makes an
ephemeral runner a first-class client rather than a special case.

## Licence

**The client packages are Apache 2.0** — see [LICENSE](./LICENSE). That covers `@mneia/cli`,
`@mneia/mcp-server`, and `@mneia/core`: the schema, the handoff format, the extraction prompts, and
the ranking algorithm. The parts that carry our judgement are inspectable and forkable.

**The server is proprietary**, and the clients require an account to function. We are not claiming to
be self-hostable — that becomes true for enterprise customers when BYOC ships, and not before.
