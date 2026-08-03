# The business

Shared by every agent working this repo — Claude Code, Codex, Cursor, Gemini CLI.

`vision.md` is the authority and runs to about 870 lines. **This file is not a summary of it.** It is
the subset an agent needs in order to notice that a technical decision is also a commercial one, and
to stop instead of guessing. Where the two disagree, `vision.md` wins and this file is the bug.

## What we sell, in one paragraph

Mneia is the shared project memory and handoff layer for teams working with AI agents. Three
operations: **checkpoint** (capture decisions and constraints at a boundary), **rehydrate** (assemble
the minimal high-signal context for the next task under a token budget), and **handoff** (produce a
receivable artifact when work changes hands). It is a hosted SaaS at **$24 per user per month**.
Everything else serves those three verbs.

## The bet

> The unit of value is not memory. It is the handoff. — §3

Competitors built places to *store* context and ways to *query* it. That is a database posture. The
job is a **transfer**: work stops with one actor and resumes with another. So the product is an
artifact produced at the moment of stopping and consumed at the moment of resuming.

Two corollaries that decide arguments:

- **Multiplayer.** Once work transfers between people, the store has several writers — which forces
  provenance, conflict resolution, and permissions. Single-user memory products cannot bolt this on.
- **Neutrality.** *"If it only works inside Claude Code, it is not a handoff, it is a session
  feature."* Model providers are structurally incentivised against neutrality. That gap is permanent
  and it is ours.

## Who pays

Architected for a **medium-sized company** — 50–500 people, 5–20 teams — from the first migration.
We *land* through engineering because the pain is sharpest there, but the schema assumes the company.

| Stage | Who | Do they pay? |
|---|---|---|
| 1 | The individual agentic developer | **No, and never ask.** They are the adoption wedge and the first dataset. |
| 2 | A tech lead on a 3–15 person team | Yes, per seat, on a card. First real revenue. |
| 3 | A multi-team engineering org | Budget owner. Governance SKU. |
| 4 | The whole company — sales, support, marketing, ops | Where the ACV actually is. |

**The commercial reason non-engineers matter:** at $24/seat, a 100-person company where only
engineers buy is ~40 seats. With every function it is ~100. That **~2.5× ACV multiplier on the same
customer** is the difference between a developer tool and company infrastructure. It is why `team`,
`function`, and a five-value `access_scope` hierarchy ship in M0 rather than month 18 — see
`.claude/rules/data-model.md`.

## Money rules that constrain code

**Do not charge for the individual tier** (§14, standing rule 7). Developers do not pay for something
they can replace with a markdown file. That tier's job is distribution.

**We pay for inference. BYOK is rejected on every tier** (MNE-174, ruled 2026-07-29). Charging $24 a
seat *and* asking for the customer's own API key funds the product twice and puts our COGS on their
bill. Owning the call also keeps prompt caching and the Batches API discount, both of which require
the call to be ours.

**Exactly one thing is worth metering: the checkpoint**, because the LLM extraction call is the
entire marginal cost. Rehydrate is one indexed query. Handoff, log, status, and search are
negligible. Seats plus a generous included checkpoint allowance, then overage — sized so ordinary
customers experience it as seat pricing and a runaway CI loop cannot quietly invert the margin.

**The §17 event spine is the metering spine.** `checkpoint.item_extracted` already fires per
checkpoint for the arbitration dataset. One system, two purposes — **do not build a second.**

**$24 is not yet load-bearing.** The allowance has to be sized against measured checkpoint cost from
the MNE-86 dogfood (MNE-180). Treat the number as provisional.

## What we may not say

These are published claims, not preferences. Getting them wrong is a legal and trust problem, not a
copy problem.

- **Never claim self-hostability, offline operation, or "no content leaves your machine."** §11.1 and
  §15 were rewritten on 2026-07-28: hosted-only makes all three untrue. The clients require an
  account and do not function without the service. Privacy is enforced by **controls** — scope
  enforcement, retention, residency — **not by locality**. MNE-50's live obligations are
  telemetry-scoped: opt-out, redaction, no content in events by default.
- **The waitlist is not a newsletter.** The privacy policy says the address is used for one thing,
  *"telling you when access opens"*, and the confirmation email promises *"one more email … nothing
  else."* Any campaign that is not the access announcement requires changing
  `apps/site/src/content/legal.ts` first, and that is a founder decision. The 30-day deletion clause
  is a live obligation.
- **Do not advertise the Team tier's feature table before it is true.** Roles, conflict resolution,
  and team handoffs are Month 6. Billing plumbing existing is not the same as the tier being
  sellable.
- **Do not publish the handoff spec** until we own the reference implementation and the early
  adopters (§16, standing rule 8). It is a standard-setting play; publishing early gives it away.
- **The subprocessor table in `legal.ts` is a published commitment.** If a change adds a service that
  touches user data, that table is part of the change.

## Who we are up against

**This is not a green field, and anyone who says otherwise is selling optimism.** The category is
funded: Mem0 raised $24M, Letta $10M, Cognee $7.5M.

**Byterover is the real competitor** — cross-vendor, shared spaces, RBAC, SOC 2 Type II, already
selling the multiplayer pitch. Our delta against them is narrow: handoff-as-object, *shipped*
conflict resolution (they announced it), and a permissive licence.

Everyone else has a structural weakness we attack: Mem0 and Supermemory are built for one user and
document cross-user pooling as a hazard; Zep/Graphiti has the strongest temporality and **no concept
of a human teammate**; Letta locks your agents into its runtime; LangSmith and Langfuse capture what
happened and produce no receivable artifact; the model providers cannot be neutral.

**The uncomfortable truth to keep on the wall:** any one of our five differentiating features can be
built by a funded team in a quarter. Features get the first thousand users. The moat is switching
cost plus the arbitration dataset.

## The moat, and why instrumentation is not optional

The moat is **not the feature list**. It is becoming a team's system of record for project decisions,
plus **a proprietary dataset of human arbitration that nobody else is collecting** — every time a
human overrides an agent, confirms a decision, or resolves a conflict.

That dataset is **not retrofittable**. It only exists if the events fire from commit one. This is why
standing rule 5 — every write path emits its §17 event — is enforced by a test rather than by
convention, and why an agent that skips an event to ship faster is destroying the asset, not cutting
a corner.

## The risk that matters most

> Individual users cope with free markdown and never pay.

**The leading indicator is individual users inviting teammates.** Kill criterion: under 1%
individual-to-team conversion after 12 months with meaningful top of funnel. Feature parity with
Byterover is survivable; a pain that is annoying but not paid-acute is not.

Practical consequence for anyone building: **a feature that makes a single user happier but does not
make them more likely to pull in a teammate is worth less than it looks.**

## Where we are

M0 (Foundations & Instrumentation) is the active milestone; M1 targets Sep 1. The core tables,
migrations, RLS, CLI, MCP server, marketing site, waitlist, and the deployed web account plane exist.
The hosted API (MNE-101) does not, and almost everything hosted waits on it.

Check `ROADMAP.md` for which milestone work belongs to before assuming something is missing.

## Non-goals

`vision.md` §19. If a request lands here the answer is **no** unless the boundary has demonstrably
moved — and moving it is a founder decision recorded in `vision.md`, not a judgement call in a PR:

agent orchestration or a runtime · observability, tracing, or evals · enterprise document search ·
a chat interface or an agent of our own · durable execution infrastructure · model hosting or
inference · a vector database (we use one) · support for every framework on day one

§11 on orchestration: *"We sit beside LangGraph, CrewAI, Claude Code. Never above them."*

Claude Code has a `scope-check` skill for this. Other agents: read §19, state which non-goal the
request touches, and ask — do not build it and mention it afterwards.
