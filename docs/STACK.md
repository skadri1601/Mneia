# Stack

> **Status: proposed, partly unresolved.** One fork remains open: Sentry in the CLI vs server-side
> only. It is tracked as a Linear decision ticket; hosting, Clerk, and the inference payer are
> resolved. The extraction model tier remains open within the closed inference-payer ruling.
> Last updated 2026-08-02 — fork 1 (hosting) closed: Cloudflare for the site, DigitalOcean for
> `apps/web` and the API.

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
| Hosting — site | **Cloudflare Workers** | MNE-195. `mneia.dev` was already on Cloudflare nameservers; one platform for DNS, proxy, and the static-ish marketing app. MCP connected. |
| Hosting — web + API | **DigitalOcean droplets** | **Resolved 2026-08-02 (MNE-165).** `apps/web` needs `pg`, `clerkMiddleware`, and a bundle bigger than the 3 MiB Worker ceiling — all three run unmodified on plain Node. SSH covers operability. |
| Database | **Neon Postgres** | §11 already ruled Postgres + pgvector. Branching gives every PR an isolated database. |
| ~~Local store~~ | **None** | Resolved by §11.1 — hosted-only, one engine. MNE-152 closed, MNE-46 cancelled. |
| Errors | **Sentry** | MCP connected — issues can be pulled and triaged without relaying stack traces. |
| Auth | **Clerk** | **Resolved 2026-08-01 (MNE-166).** Clerk is the single identity provider for web, CLI, and MCP. Mneia owns workspace, team, and scope authorization in Postgres; Clerk user ids map to `actor.external_ref`. The CLI and MCP use Mneia device-flow tokens approved in a Clerk-authenticated web session. |
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
- **No Datadog/Grafana.** Sentry plus `journalctl` on the droplet and Cloudflare's Workers logs covers
  it until there is real traffic.

## Adoption sequence

Adopting everything in M0 would be the classic solo-founder failure. Almost none of it is needed to
write MNE-42.

| Milestone | Adopt | Monthly |
|---|---|---|
| **M0** | GitHub, Actions, Vitest, Biome, changesets, Postgres in CI services | **$0** |
| **M1** | Cloudflare, DigitalOcean, Neon, Clerk — pulled forward from M2 by §11.1: nothing works without the API. **Plus Stripe and an Anthropic account**, pulled forward from M4 by the 2026-07-29 web-and-billing ruling | ~$20–50 + inference + fees |
| **M2** | Sentry | ~$0–20 |
| **M3** | PostHog (funnel only) | ~$20 |
| **M4** | — | + fees |
| **M5** | SSO provider, revisit IaC for BYOC | enterprise |

**M1 is now the milestone where cost starts.** Inference is the line item to watch: it is unbounded until
MNE-173's ceilings land, and unpriced until MNE-180 measures it. Those two are not M1 nice-to-haves.

M0 needs no account beyond GitHub.

## Open forks

Each is a Linear decision ticket. Do not drift into them (§20).

**1. ~~Vercel vs Fly.io.~~ RESOLVED 2026-08-02 (MNE-165): neither.** Cloudflare Workers keeps the
marketing site and fronts everything as DNS and proxy; **DigitalOcean droplets host `apps/web` and the
hosted API.**

Vercel's case here was never technical — it was the connected MCP server. MNE-195 retired Vercel for
`apps/site` the day before, and Cloudflare has an MCP server too, so that advantage moved with the
site. What decided the backend was `apps/web`: it opens a TCP pool with `pg`, its whole auth model is
`clerkMiddleware`, and it would sit above the 3 MiB Worker ceiling that MNE-196 and MNE-198 already
fought on a *static* site. On plain Node none of those exist. The API follows it so there is one
deploy path and one log stream rather than two of each.

This also retires the Fly.io reservation rather than deferring it: the M4 realtime concern was
long-lived connections, and a droplet has them.

**The cost, named:** we own OS patching and a reverse proxy; secrets sit on a box rather than in a
platform vault; deploys must run through GitHub Actions rather than by hand over SSH, so there is an
audit trail; and the droplet region must match the Neon project's, because standing rule 4 is a 300ms
p95 and a cross-region hop spends it before any query runs.

**Against the selection criterion above:** DigitalOcean has no MCP server. SSH more than covers it —
a shell beats a fixed tool surface, and the criterion exists so the agent is not blocked on a human
being the hands.

**2. ~~Clerk vs WorkOS vs Neon Auth.~~ RESOLVED 2026-08-01: Clerk.** Clerk is Mneia's single identity
provider for web, CLI, and MCP. Mneia's Postgres model remains the authorization source of truth, so
workspace, team, and scope checks stay behind RLS rather than moving into the identity provider. CLI
device flow remains custom work: the API issues Mneia tokens after a user approves a request in their
Clerk-authenticated web session. WorkOS and Neon Auth were rejected for this stage; reconsider the SSO
provider only if M5 requirements make Clerk insufficient.

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

## Repository boundary

Per `.claude/rules/architecture.md` and §15, this repository is private. It contains the Apache 2.0
packages (`core`, `cli`, and `mcp-server`) and may contain the proprietary hosted API and product app,
including `apps/web`, billing, and conflict UI. The product app can consume `@mneia/core` directly in
this single private repository.

If this repository is ever made public, extract the entire proprietary hosted layer into a separate
private repository before publishing: API, hosted store, product app, billing, conflict UI, permissions,
and audit. The resulting public repository may contain only the Apache 2.0 clients; a private directory
cannot protect proprietary code in a public repository.

**This repo is now M1 work, not M4 work.** The 2026-07-29 ruling puts the web app and billing in the
first milestone.

**Current remote is `skadri1601/stealth-startup`** — a placeholder. MNE-33 reserves the real org and
this repo moves under it.
