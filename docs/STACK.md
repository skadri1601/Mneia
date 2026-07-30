# Stack

> **Status: proposed, partly unresolved.** Three forks below are awaiting a founder ruling and are
> tracked as Linear decision tickets. Nothing here is settled until those close.
> Last updated 2026-07-28.

## Selection criterion

The founder reviews and directs; the agent builds, commits, and deploys. So "best tool" here means
**operable end-to-end by an agent**, ranked:

1. Has a connected MCP server → state can be read and acted on directly
2. Has a good CLI → scriptable
3. Config is text in the repo → editable, reviewable in a diff
4. GUI-only → effectively invisible; a human has to be the hands

That criterion outweighs marginal feature differences between otherwise-similar tools.

## Proposed

| Need | Pick | Why |
|---|---|---|
| Repo + CI/CD | **GitHub + Actions** | `gh` is fully agent-operable. Also required for §16 — the claude-code compaction threads *are* the distribution channel. |
| Hosting | **Vercel** | MCP connected: deploy, build logs, runtime errors, rollback without a dashboard. |
| Database | **Neon Postgres** | §11 already ruled Postgres + pgvector. Branching gives every PR an isolated database. |
| ~~Local store~~ | **None** | Resolved by §11.1 — hosted-only, one engine. MNE-152 closed, MNE-46 cancelled. |
| Errors | **Sentry** | MCP connected — issues can be pulled and triaged without relaying stack traces. |
| Auth | **Clerk** | Organizations built in, which is MNE-126/127 rather than a rewrite. |
| Billing | **Stripe** | §14, $24/seat. No real alternative for self-serve seat-based. |
| Test + lint | **Vitest + Biome** | One binary for lint and format; fewer configs to get wrong. |
| Releases | **changesets** | MNE-38. Publish on tag with npm provenance. |

## Deliberately not adopted

- **No product-analytics tool for §17 events.** They are a training dataset, not analytics — they must
  stay joinable to item ids and exportable for the MNE-117 tuning pass. Own Postgres. See
  `.claude/rules/telemetry.md`. PostHog is worth revisiting at M3 for funnel and retention only.
- **No Terraform/Pulumi.** Two managed services. IaC pays off at M5's BYOC work, not now.
- **No Redis, no separate vector DB, no Temporal/Inngest.** §19 rules out the vector DB; §11 defers
  durable execution to month 6+. And §10.3's own worked example has the team rejecting Redis on the
  critical path, which would be a slightly funny way to start.
- **No Datadog/Grafana.** Sentry plus Vercel logs covers it until there is real traffic.

## Adoption sequence

Adopting everything in M0 would be the classic solo-founder failure. Almost none of it is needed to
write MNE-42.

| Milestone | Adopt | Monthly |
|---|---|---|
| **M0** | GitHub, Actions, Vitest, Biome, changesets, Postgres in CI services | **$0** |
| **M1** | Vercel, Neon, Clerk — pulled forward from M2 by §11.1: nothing works without the API | ~$0–20 |
| **M2** | Sentry | ~$0–20 |
| **M3** | PostHog (funnel only) | ~$20 |
| **M4** | Stripe | + fees |
| **M5** | SSO provider, revisit IaC for BYOC | enterprise |

M0 needs no account beyond GitHub.

## Open forks

Each is a Linear decision ticket. Do not drift into them (§20).

**1. Vercel vs Fly.io.** Vercel wins on agent operability — a measurable difference in how much runs
unattended. Fly is better if the sync service ever needs long-lived connections or websockets. M2 sync
is request/response, so Vercel is fine, but the M4 multiplayer design may change that.

**2. Clerk vs WorkOS.** Clerk is faster to M2 and has orgs. WorkOS is built for the M5 SSO story
(MNE-144) and avoids a migration. Either way **CLI device-flow auth is custom work** — neither gives
it free, and MNE-101 should say so.

**3. Sentry in the CLI, or server-side only?** Weaker than it was: under §11.1 the item bodies are
already on our servers, so the old *"nothing leaves the machine"* argument no longer applies. What
still applies is that a crash reporter captures **local** state the product never asked for — file
paths, branch names, argv, environment. Leaning server-side only, with CLI errors written locally and
attached manually if a user chooses. Tracked as MNE-167.

**4. Who pays for inference?** The largest open item, and not really a stack question — it changes
COGS by roughly an order of magnitude and reprices §14 entirely. See §11.2 question 1. Nothing in this
document should be treated as settled until it is answered.

## Repo split

Per `.claude/rules/architecture.md` and §15:

- **`mneia/mneia`** — public, Apache 2.0: `core`, `cli`, `mcp-server`
- **`mneia/cloud`** — private: sync API, web app, billing, conflict UI

Cloud consumes `@mneia/core` from npm. A private directory inside a public repo is not possible, and
a single repo with a licence split confuses contributors.

**Current remote is `skadri1601/stealth-startup`** — a placeholder. MNE-33 reserves the real org and
this repo moves under it.
