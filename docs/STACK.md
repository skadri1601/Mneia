# Stack

> **Status: proposed, partly unresolved.** Three forks below are awaiting a founder ruling and are
> tracked as Linear decision tickets. Nothing here is settled until those close.
> Last updated 2026-07-29 — fork 4 (inference) closed; Stripe and the web app pulled into M1.

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
| Auth | **Neon Auth** (`better_auth`) | **Changed 2026-08-01, provisionally — see MNE-166.** Enabled on the Neon project and live. Its schema already ships `organization`, `member`, and `invitation`, which is the property Clerk was recommended for: MNE-126/127 become configuration, not a rewrite. It also keeps the one-dependency rule intact — auth tables sit in the same Postgres as everything else rather than adding a fourth vendor. **Cost:** the M5 SSO/SAML story (MNE-144) is weaker than WorkOS, and this option was never weighed against Clerk on its merits. |
| Billing | **Stripe** | §14, $24/seat. No real alternative for self-serve seat-based. Pulled into M1 by the 2026-07-29 ruling. |
| Inference | **Anthropic, our account** | Fork 4 closed: we pay, BYOK rejected. Server-side credential, spent on every checkpoint. Model tier still open — see MNE-180. |
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
| **M1** | Vercel, Neon, Clerk — pulled forward from M2 by §11.1: nothing works without the API. **Plus Stripe and an Anthropic account**, pulled forward from M4 by the 2026-07-29 web-and-billing ruling | ~$20–50 + inference + fees |
| **M2** | Sentry | ~$0–20 |
| **M3** | PostHog (funnel only) | ~$20 |
| **M4** | — | + fees |
| **M5** | SSO provider, revisit IaC for BYOC | enterprise |

**M1 is now the milestone where cost starts.** Inference is the line item to watch: it is unbounded until
MNE-173's ceilings land, and unpriced until MNE-180 measures it. Those two are not M1 nice-to-haves.

M0 needs no account beyond GitHub.

## Open forks

Each is a Linear decision ticket. Do not drift into them (§20).

**1. Vercel vs Fly.io.** Vercel wins on agent operability — a measurable difference in how much runs
unattended. Fly is better if the hosted API ever needs long-lived connections or websockets. Every M1
call is request/response, so Vercel is fine, but the M4 multiplayer design may change that. **More urgent
than it was:** M1 now hosts the web app too, not just the API. Tracked as MNE-165.

**2. Clerk vs WorkOS vs Neon Auth.** Clerk is faster and has orgs. WorkOS is built for the M5 SSO story
(MNE-144) and avoids a migration. Either way **CLI device-flow auth is custom work** — neither gives it
free, and MNE-101 should say so. **Raised to Urgent 2026-07-29:** MNE-181's signup and device-flow
approval pages are M1 work and cannot start until this closes.

**Overtaken by events 2026-08-01.** A third option was enabled on the Neon project and the table above
now names it. Neon Auth was never compared against the other two on the merits — it arrived through
`neon init`, not through this decision. **MNE-166 stays open** until that comparison is written down and
the founder confirms. The risk if it is left implicit: M1 gets built against `neon_auth`, and the
question closes by accretion rather than by a ruling.

**3. Sentry in the CLI, or server-side only?** Weaker than it was: under §11.1 the item bodies are
already on our servers, so the old *"nothing leaves the machine"* argument no longer applies. What
still applies is that a crash reporter captures **local** state the product never asked for — file
paths, branch names, argv, environment. Leaning server-side only, with CLI errors written locally and
attached manually if a user chooses. Tracked as MNE-167.

**4. ~~Who pays for inference?~~ CLOSED 2026-07-29 (MNE-174): we do. BYOK rejected on every tier.**
Asking for a seat price *and* the customer's own key funds the product twice; owning the call also keeps
prompt caching and the Batches API discount, which both require the call to be ours. See §14.1.

The stack consequence: **we hold an Anthropic account credential server-side and every checkpoint spends
it.** That makes two things load-bearing rather than optional — MNE-173's rate limits and per-account
inference ceilings, and MNE-180's measurement of what a real checkpoint actually costs. A flat seat price
over metered inference is only safe if both exist.

What is still open is the extraction model tier, not the payer. A Haiku-first pass with escalation to a
larger model on low-confidence or contradiction candidates may cover most items; contradiction detection
(§10.1 step 3) probably needs more. MNE-180 measures it.

## Repo split

Per `.claude/rules/architecture.md` and §15:

- **`mneia/mneia`** — public, Apache 2.0: `core`, `cli`, `mcp-server`
- **`mneia/cloud`** — private: hosted API, web app, billing, conflict UI

**This repo is now M1 work, not M4 work.** The 2026-07-29 ruling puts the web app and billing in the
first milestone, so `mneia/cloud` gets created alongside `mneia/mneia` rather than months later.

Cloud consumes `@mneia/core` from npm. A private directory inside a public repo is not possible, and
a single repo with a licence split confuses contributors.

**Current remote is `skadri1601/stealth-startup`** — a placeholder. MNE-33 reserves the real org and
this repo moves under it.
