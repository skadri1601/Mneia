# Roadmap & Working Agreement

> **Companion to [`vision.md`](./vision.md).** That document is *why*. This one is *what, in what order, and who is tracking it.*
> **Linear workspace:** https://linear.app/mneia · **Team:** Mneia (`MNE`)
> **Last updated:** 2026-07-28

---

## 0. Read this first: Linear is the source of truth for status

**This file is the map. Linear is the odometer.**

This document describes the plan and does not change often. Linear holds the live state of every task — what is in progress, what is blocked, what shipped. When the two disagree about status, **Linear is right**.

That split only works if Linear is actually kept current. Section 1 is the obligation, and it applies to the founder and to any AI agent working in this repository.

### 0.1 The rule

**Every unit of work starts by moving a Linear ticket to `In Progress` and ends by moving it to `Done`.** Work that never appears in Linear did not happen, from the perspective of anyone reading the project later — including you in four months.

This is not process for its own sake. `vision.md` §8.1 rule 1 says the company only survives if we are *"the system of record, not a cache."* A team that cannot keep its own decision log current has no business selling one.

### 0.2 For Claude Code and other agents working in this repo

**Use the `linear-ticket` skill.** It holds the full procedure — find, read, `In Progress`, branch,
work, verify the *Done when* clause, commit, PR, `Done`. It is not repeated here so the two cannot
drift apart.

The three things that matter most, if you read nothing else:

- **A ticket is `Done` only when its own *Done when* clause is satisfied** — not when the code is written
- **Found work with no ticket? Create one.** Never widen the ticket you are on
- **Blocked? Back to `Todo` with a comment.** Do not leave things parked in `In Progress` as optimism

### 0.3 The agent context files

Instructions are split by **when they need to load**, not by topic. This repo is for a company whose
whole thesis is that context windows degrade (`vision.md` §2), so a 2,000-line always-loaded
instruction file would be a poor advertisement.

| File | Loads | Holds |
|---|---|---|
| `AGENTS.md` | Every session | Vendor-neutral core: what Mneia is, commands, the nine standing rules, non-goals |
| `CLAUDE.md` | Every session | `@AGENTS.md` plus Claude-specific: permission grant, MCP servers, plan-mode guidance |
| `.claude/rules/00-index.md` | Every session | Map of the other rules. Kept tiny on purpose |
| `.claude/rules/*.md` | On matching paths | Detail per area — data model, telemetry, testing, CLI, MCP server, architecture, style |
| `.claude/skills/*/SKILL.md` | On demand | Procedures with steps that get skipped under pressure |
| `SKILLS.md` | Read on demand | Skill index and the loading budget |
| `docs/STACK.md` | Read on demand | Tooling picks and the three open forks |

**Always-loaded total: 200 lines**, against 381 lines of path-scoped rules and 227 lines of skills
that cost nothing until they are relevant. Anthropic's documented target for what loads every session
is under 200 lines, so there is no headroom — if something new needs adding, it goes into a
path-scoped rule or a skill, not into `AGENTS.md`.

### 0.4 What must never happen silently

| Situation | Required action |
|---|---|
| Scope grows beyond the ticket | New ticket, linked. Never quietly widen an existing one. |
| A ticket turns out to be wrong or unnecessary | Cancel it with a comment saying why. Do not just close it. |
| A request falls under a `vision.md` §19 non-goal | Log it under **MNE-164** with a written ruling. |
| An open decision gets made | Record it in its `DECISION` ticket **and** update `vision.md` §20. |
| A kill-criterion indicator moves | Comment on the `RISK` ticket. These tickets never close. |

---

## 1. How the workspace is organised

### 1.1 Projects

Seven projects. Six are sequential milestones from `vision.md` §13; one is standing.

| Project | Window | Success test (§13) |
|---|---|---|
| **M0 · Foundations & Instrumentation** | Jul 28 – Aug 4 | Schema migrates clean on hosted Postgres; every write path emits its §17 event |
| **M1 · Core Loop — Checkpoint & Rehydrate** | Aug 4 – **Sep 1** | The founder uses it daily and does not turn it off |
| **M2 · Handoff & Distribution** | Sep 1 – Sep 22 | 5 external people use it for a week without hand-holding |
| **M3 · Trust Layer & Public Launch** | Sep 22 – Nov 3 | 100+ installs, week-2 retention, first inbound "can my team use this" |
| **M4 · Multiplayer** | Nov 3 – Feb 9 | First paying team. **The moat clock starts.** |
| **M5 · Governance** | Feb 9 – Aug 11 | First org-level contract |
| **S0 · Strategy, Open Decisions & Risk Watch** | Standing | Never completes. Reviewed at every milestone boundary. |

> **Revised 2026-07-28 for hosted-only (§11.1).** M1 absorbed one week and MNE-101 (hosted API), because
> hosted-only means there is nothing to dogfood until the API exists. M2 lost that week and that ticket,
> so Sep 8 held and nothing downstream moved.

> **Revised 2026-07-29 — web and billing moved into M1 by founder ruling (§12.3).** MNE-25 (web review
> app), MNE-26 (billing), and the new MNE-181 (web account plane) all moved out of M4 and into M1.
> **This time the week did not come from somewhere else.** M1 grows by two weeks and **every date after it
> shifts by two weeks** — Sep 8 no longer holds.
>
> M1 is now carrying the core loop, the entire hosted API, the web app, and billing. That is three
> milestones' worth of surface in one window, and it is the single largest schedule risk on the board.
> If it slips, everything slips. Named here rather than absorbed quietly, per the same convention as above.
>
> **What stayed in M4:** MNE-22 (invites, roles, actor identity) and MNE-23 (the conflict engine, including
> MNE-133's UI). Those are multiplayer. Moving them too would have collapsed M4 entirely and stopped the
> §8.1 moat clock from meaning anything.

### 1.2 Issue structure

**29 epics, ~140 tasks.** Every task hangs off an epic; every epic belongs to a project and a milestone. Linear is authoritative on counts — this line is a shape, not a ledger.

Epics are titled `EPIC · <name>` and carry the strategic argument. Tasks carry a **Done when** clause. Two special prefixes:

- `GUARD:` — an invariant from `vision.md` that must be enforced by a **test**, not a convention. There are two: MNE-63 and MNE-69.
- `GATE:` — a milestone cannot be declared complete until this passes. There are three: MNE-88, MNE-108, MNE-125.

### 1.3 Labels

| Group | Values |
|---|---|
| **Area** | Schema, Storage, Extraction, Retrieval, Handoff, Conflict, MCP, CLI, Sync, Web, Telemetry, Interop, Infra, Docs, GTM |
| **Moat** | Switching Cost, Arbitration Data, Neutrality — *which durable advantage does this accrue (§8)* |
| **Kind** | Epic, Spike, Decision, Research |
| **Gate** | Success Test, Risk Watch, Non-Goal Guard |

Only **one label per group** per issue — Linear enforces this.

The **Moat** group is the one worth actually using. `vision.md` §8 is blunt that only two things protect this business: switching cost and the arbitration dataset. Filtering the backlog by those labels answers "am I building the moat or just building features?" — which §7.2 warns is the question that decides whether we survive contact with a funded competitor.

### 1.4 Priority

`Urgent` is reserved for things that block a milestone or enforce a `vision.md` invariant. If everything is urgent, nothing is.

---

## 2. The checklist

Tick these off here when you like — but **the ticket state in Linear is what counts.**

### M0 · Foundations & Instrumentation — Week 1

> §17: *"This is the moat. It cannot be retrofitted, because a year of unlogged usage is a year of lost training data."*

**MNE-5 · Repo, toolchain & licensing**
- [ ] MNE-33 — Reserve npm package, GitHub org, and domain
- [ ] MNE-34 — Scaffold pnpm monorepo: core / cli / mcp-server
- [ ] MNE-35 — TypeScript, lint, format, typecheck baseline
- [ ] MNE-36 — CI: build, test, typecheck, lint on every push
- [ ] MNE-37 — Apache 2.0 LICENSE, NOTICE, CONTRIBUTING, CODE_OF_CONDUCT
- [ ] MNE-38 — Release pipeline: changesets + npm publish dry run
- [ ] MNE-39 — Repo AGENTS.md / CLAUDE.md for agent contributors

**MNE-6 · Data model & storage adapters**
- [ ] MNE-40 — Migration runner and schema versioning
- [ ] MNE-41 — Schema: workspace, actor, project, session
- [ ] MNE-42 — Schema: `context_item` — provenance, trust, bi-temporal validity
- [ ] MNE-43 — Schema: checkpoint, checkpoint_item, handoff, conflict
- [ ] MNE-44 — Storage adapter interface (Postgres only — SQLite dropped, §11.1)
- [ ] MNE-45 — Postgres + pgvector
- [x] ~~MNE-46 — Vector index and retrieval parity across both engines~~ — cancelled, one engine (§11.1)
- [ ] MNE-169 — Scope enforcement at the query layer
- [ ] MNE-47 — Test fixtures, seed harness, full-column round-trip test

**MNE-7 · Telemetry spine (§17, non-negotiable)**
- [ ] MNE-48 — Event schema and typed emitter for all nine §17 events
- [ ] MNE-49 — Local JSONL sink + opt-in remote sink
- [ ] MNE-50 — Privacy: opt-out, redaction, no content by default
- [ ] MNE-51 — **Coverage test: every write path emits its event**
- [ ] MNE-52 — Arbitration dataset export
- [ ] MNE-53 — North-star metric: % of rehydrated items referenced

**MNE-8 · Embeddings layer**
- [ ] MNE-54 — Embedding provider interface
- [x] ~~MNE-55 — Default hosted provider + local offline fallback~~ — cancelled, embeddings are server-side (§11.1)
- [ ] MNE-56 — Embedding cache and backfill on provider change

---

### M1 · Core Loop — Week 2–6

> §13 success test: **the founder uses it daily on this repo and does not turn it off.**
>
> **§11.1 widened this milestone.** Hosted-only means there is no local fallback to dogfood against —
> the API has to exist before MNE-86 can run at all. MNE-101 moved here from M2, which is the whole
> cost of the decision. Do not treat M1 as a one-week milestone any more.
>
> **The 2026-07-29 ruling widened it again**, and by more. The web app and billing infra moved here from
> M4 (§12.3). M1 now covers the core loop, the hosted API, the full web surface, and Stripe. **Four
> milestones' worth of scope in one window.** Treat every date here as the thing most likely to be wrong.

**MNE-171 · Hosted API — the prerequisite hosted-only created**
- [ ] MNE-101 — Hosted API service scaffold and auth — **blocks MNE-74, MNE-81, MNE-86**
- [ ] MNE-172 — Multi-tenancy: shared schema + RLS, or schema-per-tenant (§11.2 Q3) — **decide before MNE-42**
- [ ] MNE-173 — Rate limiting and abuse controls — **hard gate on MNE-105.** Urgent since the MNE-174 ruling: we pay for inference, so this is the whole margin guard
- [ ] MNE-180 — Measure real checkpoint cost and size the §14.1 allowance — **blocks MNE-141**
- [ ] MNE-181 — Web account plane: signup, device-flow approval, workspace and project management — **blocked by MNE-166**
- [ ] MNE-165 — Vercel vs Fly ruling (needed before MNE-101 lands)
- [ ] MNE-166 — Clerk vs WorkOS ruling — **Urgent, now blocks MNE-181 as well as MNE-101**

**MNE-25 · Web review app** — *moved from M4, 2026-07-29*
- [ ] MNE-138 — Project decision browser
- [ ] MNE-139 — Checkpoint review queue
- [ ] MNE-140 — Bi-temporal timeline view — what did we believe on a given date

**MNE-26 · Billing & team tier** — *moved from M4, 2026-07-29*
- [ ] MNE-141 — Stripe integration at $24 per user per month — **blocked by MNE-180**
- [ ] MNE-142 — Seat management and upgrade flow
- [ ] MNE-143 — Individual-to-team conversion funnel instrumentation — the §18 kill-criterion measurement

> ⚠️ **Billing plumbing here does not make the §14 Team tier sellable.** Roles (MNE-127), conflict
> resolution UI (MNE-133), and team handoffs (MNE-24) are all still M4, so most of §14's Team feature
> table is not true yet. What a paying customer gets before M4 is open on MNE-26 and §20 item 9.
> **Do not ship a checkout page against §14's table until that is answered.**

**MNE-9 · Checkpoint pipeline**
- [ ] MNE-57 — Session trajectory reader: Claude Code and Cursor
- [ ] MNE-58 — Extraction prompt v1 to typed schema with validation
- [ ] MNE-59 — Precision filter: reject conversational filler aggressively
- [ ] MNE-60 — Candidate dedupe against nearest existing items
- [ ] MNE-61 — Contradiction detection v1
- [ ] MNE-62 — Human confirmation flow for load-bearing and contradicting items
- [ ] MNE-63 — **GUARD: never auto-supersede a human-confirmed item**
- [ ] MNE-64 — Atomic checkpoint and checkpoint_item write
- [ ] MNE-65 — Triggers: task boundary, day boundary, manual
- [ ] MNE-66 — Extractor quality harness: % surviving review unedited

**MNE-10 · Rehydration engine**
- [ ] MNE-67 — Scoring function v1 (w1–w7)
- [ ] MNE-68 — Per-kind quota packer under token budget
- [ ] MNE-69 — **GUARD: always include load-bearing active constraints**
- [ ] MNE-70 — Token accounting and truncation strategy
- [ ] MNE-71 — Slice render format
- [ ] MNE-72 — Reference detection: item_referenced vs item_ignored
- [ ] MNE-73 — Perf benchmark harness and p95 budget
- [ ] MNE-175 — **SPIKE:** is 300ms p95 reachable over the network? (§11.2 Q2) — measure before building a cache

**MNE-11 · MCP server v1**
- [ ] MNE-74 — Server scaffold and stdio transport
- [ ] MNE-75 — `mneia_rehydrate`
- [ ] MNE-76 — `mneia_assert`
- [ ] MNE-77 — `mneia_checkpoint`
- [ ] MNE-78 — `mneia_search`
- [ ] MNE-79 — Client compatibility matrix: Claude Code, Cursor, Codex
- [ ] MNE-80 — One-command install and config documentation

**MNE-12 · CLI v1**
- [ ] MNE-81 — `mneia init`
- [ ] MNE-82 — `mneia brief`
- [ ] MNE-83 — `mneia checkpoint` with interactive confirmation
- [ ] MNE-84 — `mneia log`
- [ ] MNE-85 — `mneia status` v1

**MNE-13 · Dogfood gate**
- [ ] MNE-86 — Run the 7-day dogfood on this repository
- [ ] MNE-87 — Friction log and backlog triage
- [ ] MNE-88 — **GATE: go/no-go ruling on opening M2**

---

### M2 · Handoff & Distribution — Week 8

> §3: *"The unit of value is not memory. It is the handoff."* This is the first thing we ship that nobody else ships.

**MNE-14 · Handoff artifact**
- [ ] MNE-89 — Handoff renderer: the eight sections
- [ ] MNE-90 — **The Superseded Recently block** ← highest-leverage item in M2
- [ ] MNE-91 — Provenance line format on every item
- [ ] MNE-92 — Freeze semantics and live link
- [ ] MNE-93 — MCP tools: `mneia_handoff_create` / `mneia_handoff_receive`
- [ ] MNE-94 — CLI: `mneia handoff` / `mneia pickup`
- [ ] MNE-95 — Open handoff semantics (`to_actor` null)
- [ ] MNE-96 — Instrument `handoff.time_to_first_action`
- [ ] MNE-97 — Handoff format spec v0 — internal, **not published**

**MNE-15 · File interop**
- [ ] MNE-98 — Import constraints from AGENTS.md / CLAUDE.md / .cursor/rules
- [ ] MNE-99 — Fenced generated-section write-back
- [ ] MNE-100 — Round-trip and clobber-protection tests

**MNE-16 · Solo tier limits and usage ledger** — *rescoped by §11.1; sync is gone*
- [x] ~~MNE-101 — Hosted API service scaffold and auth~~ — **moved to M1** under MNE-171
- [x] ~~MNE-102 — `mneia sync` push and pull~~ — cancelled, there is nothing to sync (§11.1)
- [ ] MNE-103 — Solo tier limits enforced server-side
- [ ] MNE-104 — CLI/MCP result parity test (was self-host vs hosted)
- [ ] MNE-178 — Metering and quota on the §17 event spine (§14.1) — blocked by MNE-174

**MNE-17 · Distribution v1**
- [ ] MNE-105 — npm publish and install documentation
- [ ] MNE-106 — MCP registry submissions
- [ ] MNE-107 — README leading with the compaction pain
- [ ] MNE-108 — **GATE: 5 external users for a week without hand-holding**

---

### M3 · Trust Layer & Public Launch — Week 14

> §16: lead with the compaction pain and the handoff artifact, **not** with "AI memory."

**MNE-18 · Provenance & freshness**
- [ ] MNE-109 — Actor attribution surfaced in all rendered output
- [ ] MNE-110 — `decay_after` and the freshness term in scoring
- [ ] MNE-111 — `last_verified_at` and re-verification prompts
- [ ] MNE-112 — `mneia status`: stale, disputed, unanswered

**MNE-19 · Contradiction detection v2**
- [ ] MNE-113 — Semantic contradiction classifier with an eval set
- [ ] MNE-114 — `load_bearing` auto-suggestion with human override
- [ ] MNE-115 — Supersede chains and the decision timeline in `mneia log`

**MNE-20 · Quality, eval & performance**
- [ ] MNE-116 — Rehydration eval harness with golden tasks
- [ ] MNE-117 — **First weight tuning pass from arbitration data** ← the moat's first proof of life
- [ ] MNE-118 — Extractor precision tracked over time
- [ ] MNE-119 — p95 latency budget enforced in CI

**MNE-21 · Public launch**
- [ ] MNE-120 — Landing page and docs site
- [ ] MNE-121 — GitHub issue engagement: claude-code compaction threads
- [ ] MNE-122 — Reddit engagement
- [ ] MNE-123 — Show HN
- [ ] MNE-124 — Week-2 retention instrumentation
- [ ] MNE-125 — **GATE: 100+ installs, week-2 retention, first team inbound**

---

### M4 · Multiplayer — Month 6

> §8.1 rule 3: *"Ship team features before we have teams. A year of single-player growth builds zero moat."*

**MNE-22 · Workspaces, roles & permissions**
- [ ] MNE-126 — Workspaces, invites, and membership
- [ ] MNE-127 — Roles and `access_scope` enforcement
- [ ] MNE-128 — Cross-tool, cross-machine actor identity

**MNE-23 · Conflict resolution, shipped**
- [ ] MNE-129 — Rule: agent vs agent
- [ ] MNE-130 — Rule: agent vs human-confirmed — human always wins
- [ ] MNE-131 — Rule: human vs human — never auto-resolve
- [ ] MNE-132 — `mneia_conflicts` MCP tool and `mneia conflicts` CLI
- [ ] MNE-133 — Conflict resolution UI
- [ ] MNE-134 — **Rationale capture on every resolution** ← the moat asset

**MNE-24 · Team handoffs**
- [ ] MNE-135 — Directed handoffs and inbox
- [ ] MNE-136 — Handoff notifications
- [ ] MNE-137 — Cross-human `time_to_first_action` measurement

- [x] ~~MNE-25 · Web review app~~ — **moved to M1** (2026-07-29 ruling, §12.3)
- [x] ~~MNE-26 · Billing & team tier~~ — **moved to M1** (2026-07-29 ruling, §12.3)

> **What this milestone is now for.** With web and billing gone, M4 is exactly the multiplayer semantics:
> invites and roles, the conflict engine, and team handoffs. That is the right residue — §8.1 rule 3 says
> the moat clock starts when a **second actor** writes to one project, and none of the three blocks above
> are reachable with one user. **MNE-133's conflict UI stayed here deliberately**, with the engine it
> renders, rather than following the rest of the web app forward into a screen with no rows.
>
> It also means M4 is where §14's Team feature table finally becomes true, which is what §20 item 9 is
> waiting on.

---

### M5 · Governance — Month 12

> §5: *"The trap to avoid: building for Stage 3 first."* Nothing here starts before M4 has a paying team.

**MNE-27 · Enterprise controls**
- [ ] MNE-144 — SSO and SAML
- [ ] MNE-145 — Audit export
- [ ] MNE-146 — Permission scopes for restricted items
- [ ] MNE-147 — BYOC and on-prem deployment
- [ ] MNE-148 — Support SLA and operational runbooks

**MNE-28 · Trust & compliance posture**
- [ ] MNE-149 — SOC 2 readiness assessment
- [ ] MNE-150 — Security page, subprocessor list, data handling policy

---

### S0 · Strategy, Open Decisions & Risk Watch — standing

**MNE-31 · Open decisions (§20)** — each closes with a written ruling **and** a `vision.md` update

- [x] ~~MNE-151 — **DECISION 1: Product name**~~ — **RESOLVED: Mneia**
- [x] ~~MNE-152 — **DECISION 2: Local store default**~~ — **RESOLVED: hosted Postgres only** (§11.1)
- [ ] MNE-153 — DECISION 3: Does Claude Code expose a pre-compaction hook (due Aug 7)
- [ ] MNE-154 — DECISION 4: Should AGENTS.md write-back be default-on (due Aug 25)
- [ ] MNE-155 — DECISION 5: Vertical wedge or stay horizontal (due Sep 30)
- [ ] MNE-156 — DECISION 6: Co-founder profile and when to start looking (due Oct 20)

*Opened by the MNE-152 ruling — the §11.2 questions hosted-only created:*

- [x] ~~MNE-174 — **DECISION 7: Who pays for inference**~~ — **RESOLVED 2026-07-29: we do. BYOK rejected on every tier** (§14.1)
- [ ] MNE-176 — DECISION 8: Embedding vendor and dimensions — Anthropic has no embeddings endpoint
- [ ] MNE-177 — DECISION 9: What "open source" means once the server is proprietary
- [x] ~~MNE-170 — Cross-department scope~~ — **RESOLVED: in scope** (§5 Stage 4)

Three more §11.2 questions are implementation rather than strategy and live in M1: **MNE-172** (multi-tenancy), **MNE-173** (rate limiting), **MNE-175** (latency spike).

*Opened by the MNE-174 ruling — because we pay, none of the BYOK relief arrives:*

- [ ] MNE-180 — Measure real checkpoint cost and size the §14.1 allowance (M1) — **the $24 is not load-bearing until this lands**
- MNE-173 raised to Urgent: it is now the full margin guard, not ordinary read-path limiting
- MNE-176 keeps all of its cost pressure — we own that call too

*Opened by the 2026-07-29 web ruling:*

- [ ] MNE-166 — DECISION: Clerk or WorkOS — raised to **Urgent**; now blocks MNE-181 as well as MNE-101
- [ ] **§20 item 9 — what a paying customer gets before M4.** Billing plumbing lands in M1 but §14's Team feature table does not become true until M4. Tracked on MNE-26; needs a founder ruling before any checkout page ships.

**MNE-29 · Kill-criteria watch (§18)** — **these never close**

- MNE-157 — RISK 1: Developers cope with free markdown and never pay ← *the one to watch above all others*
- MNE-158 — RISK 2: Model providers bundle it
- MNE-159 — RISK 3: It is a feature, not a company
- MNE-160 — RISK 4: Byterover outruns us
- MNE-161 — RISK 5: Workflow change is too costly

**MNE-32 · Competitive & ecosystem watch**
- MNE-162 — Byterover watch: conflict resolution, licensing, team traction
- MNE-163 — Provider and IDE-native memory watch

**MNE-30 · Scope discipline (§19)**
- MNE-164 — Standing ruling log for non-goal requests

---

## 3. Standing rules that override individual tickets

These come from `vision.md` and outrank any ticket that contradicts them.

1. **Never auto-supersede a human-confirmed item with an agent assertion.** §10.1 step 5, and the word *ever* is in the original. Enforced by MNE-63 and MNE-130.
2. **Always include load-bearing active constraints in a rehydration slice**, regardless of score or budget pressure. §10.2. Enforced by MNE-69.
3. **Human vs human conflicts are never auto-resolved.** §10.4 — *"silence here is how teams get burned."*
4. **`mneia_rehydrate` p95 stays under 300ms.** §12.1 — *"if it is slow, nobody uses it and the whole product fails."*
5. **Every write path emits its §17 event.** Enforced by MNE-51.
6. **No code or conversation content leaves the machine by default.** MNE-50.
7. **Do not charge for the individual tier.** §14.
8. **Do not publish the handoff spec** until we own the reference implementation and the early adopters. §16 item 5.
9. **Do not build anything in §19.** Log the request under MNE-164 and rule on it — `scope-check` skill.

These nine are restated in `AGENTS.md` so they load into every agent session. If you change one here,
change it there too.

---

## 4. Milestone boundary ritual

**Use the `milestone-gate` skill** — it walks these four and knows the gate tickets per milestone.

Before opening the next project, do all four:

1. **Run the `GATE:` ticket** for the milestone that is ending. Write the ruling down. A failed gate means the next milestone does not open — that is the entire point of having one.
2. **Walk S0.** Review all five `RISK` tickets and comment on any indicator that moved. Check whether any open decision has been drifted into rather than decided.
3. **Check the north-star.** Is the percentage of rehydrated items that get referenced climbing per team? §17: *"If it stays flat, we are a nicer markdown file."*
4. **Update `vision.md`** if any ruling changed the plan. A vision document that no longer matches reality stops being read, and then stops being followed.

---

## 5. Quick reference — Linear via MCP

```
list_issues    team: "Mneia", project: "M0 · Foundations & Instrumentation", state: "Todo"
get_issue      id: "MNE-42"
save_issue     id: "MNE-42", state: "In Progress"
save_issue     team: "Mneia", title: "...", project: "...", parentId: "MNE-6", labels: ["Schema"]
save_comment   issueId: "MNE-42", body: "..."
list_projects  team: "Mneia"
```

States: `Backlog` → `Todo` → `In Progress` → `Done`, plus `Canceled` and `Duplicate`.
Priority: `1` Urgent, `2` High, `3` Medium, `4` Low.
