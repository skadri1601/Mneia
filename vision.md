# Mneia: Project Brief

> **Name:** Mneia. Settled 2026-07-28. Earlier working name was Baton; alternatives considered were Throughline, Relay, Anchor, Continuity.
> **Status:** Pre-code. This document is the founding brief and the context file for Claude Code.
> **Last updated:** 2026-07-28
> **One line:** The shared project memory and handoff layer for teams working with AI agents.

---

## 0. How to use this document

This is the single source of truth for what we are building and why. It is written to be read by three audiences: the founder, a future co-founder, and Claude Code.

If you are Claude Code: sections 8 through 12 are the buildable spec. Sections 13 and 19 tell you what NOT to build. Section 17 is non-negotiable and must be implemented from the first commit, not retrofitted.

---

## 1. The bet, in five sentences

1. Long-running AI agent sessions degrade. Context windows fill, compaction is lossy, and recall drops well before the window is full. This is measured, not anecdotal.
2. Every provider has responded by externalizing context (memory tools, compaction, CLAUDE.md, AGENTS.md), which means the context layer is a real and permanent architectural component, not a temporary hack.
3. The existing context and memory products are built for one user and one agent. Nobody has built the layer for **several humans and several agents working the same project over weeks**.
4. Our wedge is the artifact nobody ships: a **handoff**. Not a memory store you query, but an object a person or agent receives when picking up work.
5. Our moat is not the feature list. It is the switching cost of becoming a team's system of record for project decisions, plus a proprietary dataset of human arbitration that nobody else is collecting.

---

## 2. The problem

### 2.1 What actually happens

A developer works with Claude Code or Cursor for three hours on Monday. They establish twenty decisions along the way: why Postgres over DynamoDB, which auth pattern, which edge cases are out of scope, what broke when they tried the obvious approach. On Tuesday they open a new session. The agent knows none of it. They spend the first fifteen minutes re-explaining.

Worse: mid-session, auto-compaction fires. The agent silently loses the constraint established two hours ago and confidently proposes the approach that was already rejected.

Worse still: a teammate picks up the work. They have no access to any of it. The decisions live in a chat transcript that was compacted away, or in one person's head.

### 2.2 The evidence this is real, not imagined

**Technical research:**
- Chroma, "Context Rot: How Increasing Input Tokens Impacts LLM Performance" (Hong, Troynikov, Huber; July 2025). Tested 18 models including GPT-4.1, Claude 4, Gemini 2.5, Qwen3. Performance degrades non-uniformly as input grows, well before the window fills.
- NoLiMa (Modarressi et al., ICML 2025). At 32K tokens, 11 of 13 tested long-context models drop below 50% of their short-context baseline. GPT-4o fell from 99.3% to 69.7%.
- "Lost in the middle" (Liu et al.), corroborated by RULER: effective context is far shorter than advertised context.
- Cognition, "Don't Build Multi-Agents": sub-agents make conflicting implicit decisions when they lack shared context. Error compounding across long trajectories is the central reliability problem.
- Anthropic's own context engineering guidance treats context as a finite resource requiring compaction, structured note-taking, and isolation.

**Practitioner evidence:**
- `anthropics/claude-code` (approximately 77k stars) carries a persistent cluster of compaction and context-loss issues. One user documented 59 compactions in 26 days and hand-built a three-tier memory system; the thread drew 26 or more "same problem" replies naming rival hand-rolled tools (Engram, claude-mem, agentmemory, Memorix, Context Forge, MCP Memory Keeper).
- Related issues: "completely lost memory of very basic things" after auto-compact; `/compact` dropping CLAUDE.md rules; compaction data loss.
- A visible ecosystem of DIY markdown and scratchpad workarounds exists across r/ClaudeAI, r/cursor, r/LLMDevs, and dev.to. **People are already hand-building this. That is the strongest possible demand signal, and also the strongest signal that they may not pay for it.** See section 18.

### 2.3 Why it gets worse, not better

Bigger context windows do not fix it (NoLiMa and Chroma both show degradation is not a capacity problem). More agents per team multiplies it. More teammates using agents multiplies it again. The trend line points our way.

---

## 3. The thesis

**What we believe that the market does not yet act on:**

> The unit of value is not memory. It is the handoff.

Every competitor built a place to *store* context and a way to *query* it. That is a database posture. The actual job to be done is a transfer: work stops with one actor and resumes with another (the same human tomorrow, a different human next week, a different agent on the next task). The thing that should exist is an artifact produced at the moment of stopping and consumed at the moment of resuming.

Two corollaries:

- **Corollary A (multiplayer):** once work is transferred between people, the context store must handle several writers, which forces provenance, conflict resolution, and permissions. Single-user memory products cannot bolt this on without changing their thesis, because pooling context across users is a privacy and correctness hazard they explicitly warn against.
- **Corollary B (neutrality):** a handoff must survive crossing tools. If it only works inside Claude Code, it is not a handoff, it is a session feature. Model providers are structurally incentivized against neutrality. That gap is permanent.

---

## 4. What we are building

**Product definition:** a structured, cross-vendor project context store with three operations on top of it.

| Operation | What it does |
|---|---|
| **Checkpoint** | At a task or day boundary, extract structured decisions, constraints, open questions, and artifacts from the session; detect contradictions with existing state; ask the human to confirm load-bearing items. |
| **Rehydrate** | Given the next task, assemble the minimal high-signal context slice under a token budget. Not replay-everything. Not raw semantic search. |
| **Handoff** | Produce a receivable artifact: what is done, current state, open questions, constraints, next action, with provenance on every line. |

Everything else in the product exists to serve those three.

**Surfaces:** an MCP server (works in Claude Code, Cursor, Codex, any MCP client), a CLI, file interop with `AGENTS.md` / `CLAUDE.md`, and a thin web app — account plane plus review. All four ship together in the first milestone (§12.3). Conflict resolution joins the web app later, with multiplayer.

**Deployment:** a hosted service. Apache-2.0 client packages — CLI, MCP server, schema, prompts, ranking — against a proprietary API. Not self-hostable until BYOC ships (§11.1, §15).

---

## 5. Who we are targeting

> **Revised 2026-07-28.** The original plan targeted three groups in strict sequence and treated anything past a 15-person engineering team as a month-18 concern. That ceiling is lifted. **Mneia is architected for a medium-sized company — roughly 50 to 500 people, 5 to 20 teams, several functions — from the first migration.** We still *land* through engineering, because that is where the pain is sharpest and the distribution is free. But the data model, the scope hierarchy, and the roadmap now assume the company, not the team.
>
> This is a deliberate trade: more schema work in M0, security review arriving earlier, and a longer path to first revenue, in exchange for not rebuilding the foundation at month 18. The old sequencing is preserved below as the landing path.

### The unit we build for: a medium-sized company

- **Shape:** 50–500 people. 5–20 teams. Multiple functions — engineering, product, design, sales, marketing, support, success, operations, finance.
- **Why this is the right unit:** context does not stop at a team boundary. A decision made in the payments team changes what the sales team can promise. An open question in platform blocks three feature teams. The pain the founding brief describes — *"the decisions live in a chat transcript that was compacted away, or in one person's head"* — is worse across teams than within one, because there is no shared transcript at all.
- **What that forces into the schema:** teams as a first-class entity, a visibility hierarchy from individual to company, and function on the team so a support engineer's default view is not a backend team's debugging trail. §9 carries these from the first migration.

### Non-engineers are users, not just beneficiaries

Sales, support, marketing, and operations people now use Claude Code and build things with it. They do not want, and should not have, a backend team's root-cause analysis in their context. But they have a real and unserved question:

> *A customer asks for a feature in a call. Is it on the roadmap? Who is building it? What is the state? Who do I talk to?*

Every part of that answer already exists in the §9 model — a `decision` with rationale, `asserted_by`, an unresolved `open_question`, a supersede chain. It needs no new object. It needs enough teams checkpointing, cross-project query with scope enforcement, and a surface they will actually use.

**Commercially this is the largest single number in the plan.** At §14's $24/seat, a 100-person company where only engineers buy is roughly 40 seats. With non-engineering functions it is closer to 100. That is a **~2.5× ACV multiplier on the same customer**, and it is the difference between a developer tool and company infrastructure.

### The landing path

Targeting a medium company does not mean selling to one on day one. The sequence below is how we get in the door; it is a go-to-market order, not an architecture constraint.

| Stage | Who | Pain | Buyer |
|---|---|---|---|
| **1** — months 0–6 | The individual agentic developer using Claude Code, Cursor, or Codex daily | Cross-session context loss, compaction damage, re-explaining | **Nobody. They will not pay** — they are the adoption wedge and the first dataset |
| **2** — months 6–18 | A tech lead on a 3–15 person engineering team, especially mid-migration or mid-refactor | Context in individual heads; onboarding onto in-flight work is expensive; agents contradict settled decisions | The tech lead, on a card, per seat. First real revenue |
| **3** — months 18+ | A multi-team engineering org — platform, DX, or an engineering leader | No record of what agents decided or why; no audit trail; no governance over what context agents can see | Budget owner. Governance SKU |
| **4** | The company — sales, support, marketing, operations alongside engineering | Cross-functional questions have no answer that is both current and trustworthy | Org-wide deployment. Where the ACV actually is |

### The traps

**Do not sell to Stage 3 or 4 before Stage 2 works.** Building *for* a medium company is an architecture decision. *Selling* to one still requires logos we do not have and a security review we cannot yet pass. The schema assumes the company; the sales motion does not.

**Do not build surfaces before data.** The Stage 4 question — *"is this on the roadmap?"* — is unanswerable until several teams have been checkpointing for months. A Slack bot over an empty store answers nothing. Surfaces follow data, never lead it (§12.4).

**Do not stay in Stage 1 for a year.** Individual users accrue no moat. See §7 and §8.

---

## 6. Competitive landscape

### 6.1 The map

| Player | What it actually is | Scope | Structural weakness we attack |
|---|---|---|---|
| **Byterover (Cipher)** | Cross-vendor memory with Git-style versioning, shared spaces, RBAC, SOC 2 | Team-aware | **Our real competitor.** Conflict resolution announced but unshipped. Curate-then-query, not live handoff. Elastic License 2.0 limits true OSS adoption. Very small team. |
| **Mem0** | Managed memory API, vector + optional graph, LLM fact extraction with self-editing | Single user / agent | Built for personalization. Docs describe isolated user memory spaces; pooling across users is a documented hazard. Graph features paywalled. Cannot pivot to shared team state without changing thesis. |
| **Zep / Graphiti** | Temporal knowledge graph, bi-temporal validity, contradiction invalidation | Single user / agent | Technically the strongest on temporality and provenance of *facts*. Has no concept of a human teammate, a role, or a handoff. Retired self-hosted Community Edition. |
| **Letta (MemGPT)** | Stateful agent runtime with tiered memory | Agent-scoped | Architectural lock-in: your agents run inside Letta. Infrastructure to build agents, not a product for teams. |
| **Supermemory** | Universal memory API, contradiction resolution, team containers | Mostly single user | Closed source, self-host requires enterprise agreement. No versioning, review workflow, or handoff. |
| **Cognee** | OSS ECL pipeline unifying relational, vector, graph | Single user | Local-first, developer-primitive. No team collaboration or governance. |
| **LangGraph checkpointer** | Thread-scoped run state persistence + cross-thread Store | Thread / framework | Persists execution state, not semantic project knowledge. Framework-bound. |
| **Temporal / Inngest / Restate / DBOS** | Durable execution | Workflow | Explicitly persists workflow state, not project meaning. Not a competitor; a dependency we may sit on. |
| **Anthropic / OpenAI / Cursor native** | Memory tools, compaction, context editing, CLAUDE.md, rules, AGENTS.md | Single vendor | Structurally cannot be neutral. Every one wants its own instructions file. The "markdown museum" problem is theirs to keep. |
| **Glean** | Enterprise permissions-aware knowledge search | Org documents | Indexes documents and activity, not live project decisions. Enterprise-priced, enterprise sales motion, too slow for the developer inner loop. |
| **LangSmith / Langfuse / Braintrust** | Agent observability and eval | Traces | Captures what happened; produces no receivable artifact. Could expand here, but incentives point at debugging. |

### 6.2 The honest read

Do not tell yourself this is a green field. It is not.

- The memory category is funded and moving (Mem0 raised $24M; Letta $10M; Cognee $7.5M; Supermemory a seed round).
- **Byterover is already selling the multiplayer pitch.** Cross-vendor, shared spaces, RBAC, Git-style memory versioning, SOC 2 Type II.
- Against Byterover specifically, our feature delta is narrow: handoff-as-object, shipped conflict resolution, and a permissive license.

**This is a wedge that requires fast execution, not an uncontested market.** Anyone who tells you otherwise is selling optimism.

---

## 7. Our features versus their drawbacks

### 7.1 The five things we ship that nobody ships together

| # | Feature | Who has it today | Their drawback |
|---|---|---|---|
| 1 | **Handoff as a first-class object.** A receivable artifact produced on stop and consumed on resume. | **Nobody.** | Everyone stores memory. Nobody hands off. The closest thing is "query the memory store," which puts the burden on the receiver. |
| 2 | **Conflict resolution across humans and agents.** Explicit arbitration when a teammate and an agent disagree about project state. | **Nobody shipped.** Byterover announced it. | Single-user products have no conflicts by construction. Zep invalidates contradicted facts automatically, which is wrong for decisions where a human must arbitrate. |
| 3 | **Provenance with actor attribution.** Every item records whether a human or an agent asserted it, which one, when, and on what basis. | Partial (Zep has episode-level provenance for facts; Byterover has commit history). | None distinguish human authority from agent assertion, which is the distinction that matters when deciding what to trust. |
| 4 | **Selective rehydration under a token budget.** Choose the minimal correct slice for *this next task*. | Partial and indirect. Compaction and context editing shrink; they do not select. | Compaction is lossy by design and task-blind. Semantic search returns what is similar, not what is load-bearing. |
| 5 | **Boundary-triggered structured checkpoints.** Explicit capture at task or day boundaries into a typed schema. | Partial (Anthropic compacts on thresholds; memory products capture ambiently). | Ambient capture produces noise. Threshold compaction fires when the window is full, which is the worst possible moment and produces no reviewable artifact. |

### 7.2 The uncomfortable truth to keep on the wall

**Any one of these five can be built by a funded team in a quarter.** If our plan is feature superiority, we lose. Features get us the first thousand users. Section 8 is what keeps them.

---

## 8. The moat stack

This is the most important section in the document.

| Moat | Real? | Time to accrue | Copyable by a funded competitor? |
|---|---|---|---|
| **Switching cost: we become the system of record for project decisions** | Strongest | 6 to 18 months of team usage | **No.** Nobody can copy a customer's 18 months of decisions and rationale. |
| **Arbitration dataset: which conflicts humans resolved which way, which rehydrated context got used vs ignored** | Real, slow | 12 to 24 months | **No,** but only if instrumented from commit one. Not purchasable. |
| Cross-vendor neutrality | Real, structural | Immediate | Labs cannot (incentives). Byterover already has it. |
| Intra-org network effect (value rises per teammate and agent connected) | Weak to moderate | 3 to 12 months | Yes, but slow to seed. |
| Standard or protocol ownership | Aspirational | 18 months+ | Yes. Publishing a spec helps competitors unless we own the reference implementation and the adopters. |
| OSS mindshare and distribution | Real but perishable | 3 to 6 months | Yes, quickly, with funding. |

**Only two of these protect us: switching cost and the arbitration dataset. Everything else is a head start.**

### 8.1 What this means for every product decision

Three rules that override feature requests:

1. **Be the system of record, not a cache.** If a team can delete Mneia and lose nothing because the real decisions still live in Slack and Git, we have no switching cost. Every feature must answer: does this make us harder to remove in eighteen months?
2. **Instrument arbitration from the first commit.** Every human override of an agent, every confirmed stale fact, every merged conflict, every discarded rehydration slice is a labeled example nobody else is collecting. See section 17. This is not analytics. This is the asset.
3. **Ship team features before we have teams.** The network effect only starts when multiple actors write to the same project. A year of single-player growth builds zero moat.

### 8.2 The scenario to plan against

Byterover ships conflict resolution in Q3. Cursor adds shared team memories. What survives?

Not the features. What survives is that a team has been checkpointing into our store for a year, our rehydration is measurably better because it learned from their corrections, and leaving means abandoning their institutional memory.

**If we cannot articulate why a team stays after eighteen months, the business does not exist regardless of how good v1 looks.**

---

## 9. Core data model

Postgres with pgvector. Bi-temporal where it matters. Provenance on everything.

```sql
-- Actors: humans and agents are first-class and distinguishable
CREATE TYPE actor_kind AS ENUM ('human', 'agent');

CREATE TABLE actor (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  kind          actor_kind NOT NULL,
  display_name  TEXT NOT NULL,
  external_ref  TEXT,          -- e.g. github handle, or 'claude-code@sonnet-4.6'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Teams are first-class. A medium company has 5 to 20 of them, and the
-- function determines what a member's default context looks like.
CREATE TYPE team_function AS ENUM (
  'engineering', 'product', 'design', 'sales', 'marketing',
  'support', 'success', 'operations', 'finance', 'other'
);

CREATE TABLE team (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  slug          TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  function      team_function NOT NULL DEFAULT 'engineering',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TYPE team_role AS ENUM ('lead', 'member');

CREATE TABLE team_member (
  team_id   UUID NOT NULL REFERENCES team(id),
  actor_id  UUID NOT NULL REFERENCES actor(id),
  role      team_role NOT NULL DEFAULT 'member',
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, actor_id)
);

-- A project is a body of work, not necessarily a repo. `repo_url` stays
-- nullable so a sales team's "Q3 enterprise motion" is as valid as a
-- backend service.
CREATE TABLE project (
  id            UUID PRIMARY KEY,
  workspace_id  UUID NOT NULL REFERENCES workspace(id),
  team_id       UUID REFERENCES team(id),
  slug          TEXT NOT NULL,
  repo_url      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE session (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES project(id),
  actor_id      UUID NOT NULL REFERENCES actor(id),
  tool          TEXT,          -- 'claude-code' | 'cursor' | 'codex' | 'cli'
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ
);

-- The heart of the system
CREATE TYPE item_kind AS ENUM (
  'decision',        -- a choice made, with rationale
  'constraint',      -- a rule that must hold
  'open_question',   -- unresolved, needs an answer
  'fact',            -- an observed truth about the system
  'artifact_ref'     -- pointer to a PR, doc, ticket, file
);

CREATE TYPE item_status AS ENUM ('active', 'superseded', 'disputed', 'retired');

-- Visibility. Ordered narrowest to widest; `restricted` is an explicit
-- grant list and sits outside the ordering.
CREATE TYPE access_scope AS ENUM (
  'private',    -- the asserting actor only
  'project',    -- this project / repo (default)
  'team',       -- the owning team, across all its projects
  'workspace',  -- the whole company
  'restricted'  -- explicit grant list — several named teams or actors
);

CREATE TABLE context_item (
  id                UUID PRIMARY KEY,
  project_id        UUID NOT NULL REFERENCES project(id),
  kind              item_kind NOT NULL,
  title             TEXT NOT NULL,           -- one line, human readable
  body              TEXT,                    -- rationale, detail
  status            item_status NOT NULL DEFAULT 'active',

  -- provenance: who said this and on what basis
  asserted_by       UUID NOT NULL REFERENCES actor(id),
  asserted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_session_id UUID REFERENCES session(id),
  source_ref        TEXT,                    -- git sha, PR url, message permalink

  -- trust and freshness
  confidence        REAL NOT NULL DEFAULT 0.5,   -- 0..1
  human_confirmed   BOOLEAN NOT NULL DEFAULT false,
  load_bearing      BOOLEAN NOT NULL DEFAULT false, -- if wrong, work goes wrong
  last_verified_at  TIMESTAMPTZ,
  decay_after       INTERVAL,                -- null = does not go stale

  -- bi-temporal validity
  valid_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to          TIMESTAMPTZ,             -- null = still valid
  supersedes_id     UUID REFERENCES context_item(id),
  superseded_by_id  UUID REFERENCES context_item(id),

  -- visibility hierarchy, widest-reaching last
  access_scope      access_scope NOT NULL DEFAULT 'project',
  embedding         VECTOR(1536)
);

CREATE INDEX ON context_item (project_id, status, kind);
CREATE INDEX ON context_item USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE checkpoint (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES project(id),
  session_id    UUID REFERENCES session(id),
  actor_id      UUID NOT NULL REFERENCES actor(id),
  trigger       TEXT NOT NULL,   -- 'task_boundary' | 'day_boundary' | 'manual' | 'pre_compaction'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary       TEXT
);

CREATE TABLE checkpoint_item (
  checkpoint_id UUID NOT NULL REFERENCES checkpoint(id),
  item_id       UUID NOT NULL REFERENCES context_item(id),
  action        TEXT NOT NULL,   -- 'created' | 'updated' | 'superseded' | 'rejected'
  PRIMARY KEY (checkpoint_id, item_id)
);

CREATE TABLE handoff (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES project(id),
  from_actor    UUID NOT NULL REFERENCES actor(id),
  to_actor      UUID REFERENCES actor(id),  -- null = open handoff, anyone may pick up
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  received_at   TIMESTAMPTZ,
  next_action   TEXT NOT NULL,
  rendered      TEXT NOT NULL     -- the frozen markdown artifact
);

CREATE TABLE conflict (
  id            UUID PRIMARY KEY,
  project_id    UUID NOT NULL REFERENCES project(id),
  item_a        UUID NOT NULL REFERENCES context_item(id),
  item_b        UUID NOT NULL REFERENCES context_item(id),
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ,
  resolved_by   UUID REFERENCES actor(id),
  resolution    TEXT              -- 'a_wins' | 'b_wins' | 'merged' | 'both_retired'
);
```

**Design notes worth defending:**
- `actor_kind` distinguishing human from agent is not cosmetic. It is how rehydration decides what to trust and how conflict resolution decides who arbitrates.
- `load_bearing` is the flag that decides whether a contradiction blocks or merely logs. Getting this right is most of the product quality.
- Bi-temporal (`valid_from`, `valid_to`, `supersedes_id`) means we can answer "what did we believe on March 3rd," which matters for postmortems and for audit later.
- **`access_scope` is a hierarchy, not a flag.** Individual → project → team → company. It ships in the first migration for the same reason bi-temporality does: widening a visibility model after real multi-team data exists is a migration nobody survives cleanly.
- **Scope is ratified, never routed.** The extractor *suggests* a scope; the human confirms or overrides it at checkpoint, exactly as with `load_bearing`. "Escalating" an item to company-wide is a scope change with provenance — attributed, dated, and visible in the checkpoint history — **not** an approval workflow with its own object and state machine. This gets the founder's escalation model with zero new machinery, and every override becomes another labelled example for §17.
- **Function lives on the team, not the actor.** A support engineer's default view differs from a backend team's because their *team's* function differs. Deriving it from team membership keeps one source of truth and survives people moving between teams.
- **Deliberately not modelled: a separate subject axis.** An item is *about* its project and *visible* per `access_scope`; those two carry the load. A distinct "what is this concerned with" dimension is speculative until a real case demands it.

---

## 10. The three operations

### 10.1 Checkpoint

**Triggers:** task boundary (agent finishes a unit of work), day boundary (scheduled), manual (`mneia checkpoint`), and pre-compaction (hook, if the client exposes one).

**Pipeline:**
1. Read the session trajectory since the last checkpoint.
2. Extract candidate items into the typed schema. Prompt for decisions, constraints, open questions, facts, artifact refs. Reject conversational filler aggressively; precision beats recall here.
3. For each candidate, retrieve the nearest existing items and run contradiction detection.
4. Non-contradicting, non-load-bearing items: write directly with `confidence` from the extractor and `human_confirmed = false`.
5. Contradicting or load-bearing items: surface to the human for confirmation. **Do not auto-supersede a human-confirmed item with an agent assertion. Ever.**
6. Write a `checkpoint` row and the `checkpoint_item` links, so every write is attributable to a checkpoint.

**Quality metric:** what fraction of extracted items survive human review without edit. Track it from day one.

### 10.2 Rehydrate

Given a task description and a token budget, return the minimal slice.

Scoring sketch (tune empirically, do not treat these weights as gospel):

```
score(item, task) =
    w1 * semantic_relevance(item, task)      // embedding similarity
  + w2 * recency_decay(item.asserted_at)
  + w3 * item.confidence
  + w4 * (item.human_confirmed ? 1 : 0)
  + w5 * (item.load_bearing ? 1 : 0)
  + w6 * freshness(item)                      // penalize past decay_after
  - w7 * (item.status = 'disputed' ? 1 : 0)
```

Then pack greedily under the budget with **per-kind quotas** so a pile of similar facts cannot crowd out every constraint. Suggested default split for a 4k budget: constraints 30%, decisions 30%, open questions 20%, facts 15%, artifact refs 5%.

Always include: all `load_bearing` active constraints, regardless of score. A constraint that gets dropped is how the agent redoes the rejected approach.

**Quality metric:** of the items included in a slice, how many were referenced or acted on. Instrument this (section 17).

### 10.3 Handoff

The differentiating artifact. Rendered markdown, frozen at creation, plus a live link.

```markdown
# Handoff: payments-migration
From: Saad (human) · 2026-07-26 18:40 UTC
To: open

## Next action
Wire the retry path in `charges/worker.rb` to the new idempotency key. Nothing else is blocking.

## State
Ledger writes are cut over and green in staging. Read path is still dual-reading.
Rollback flag `payments.v2_reads` is live and tested.

## Constraints (do not violate)
- [human · confirmed 2026-07-14] No downtime window. Cutover must be online.
- [human · confirmed 2026-07-02] Idempotency keys are namespaced per merchant, not global.
- [agent · claude-code · unconfirmed] Stripe webhook ordering is not guaranteed; do not rely on it.

## Decisions and why
- [2026-07-11 · human] Postgres advisory locks over Redis for the cutover lock.
  Rationale: we already page on Postgres; adding a Redis dependency to the critical path was rejected.
- [2026-07-19 · agent, human-confirmed] Dual-read window set to 14 days, not 7.
  Rationale: month-end reconciliation needs a full cycle inside the window.

## Open questions
- [ ] Who owns the backfill for pre-2024 charges? Unassigned since 2026-07-08.
- [ ] Do we need the dual-read window extended for EU entities? Raised by agent, unverified.

## Superseded recently (do not re-propose)
- ~~Redis-based cutover lock~~ superseded 2026-07-11, see decision above.
- ~~7-day dual-read window~~ superseded 2026-07-19.

## Artifacts
- PR #2841 (ledger cutover)
- ADR-017
```

**The "superseded recently" block is the highest-value section and the one nobody else produces.** It is what stops an agent from confidently re-proposing the thing the team already rejected.

### 10.4 Conflict resolution

- **Agent vs agent:** higher confidence wins, tie broken by recency, logged, no human interrupt unless `load_bearing`.
- **Agent vs human-confirmed:** human always wins. The agent assertion is stored as `disputed` and surfaced, never silently applied.
- **Human vs human:** never auto-resolve. Mark both `disputed`, surface to both actors, block the item from rehydration until resolved. Silence here is how teams get burned.
- Every resolution writes a `conflict` row with the outcome. **This table is the moat asset.**

---

## 11. Architecture and build-versus-adopt

> **Revised 2026-07-28 — hosted-only.** Mneia is a hosted service. There is no local database, no
> sync, and no offline mode. Every surface — CLI, MCP server, web, Slack — is an authenticated client
> against one hosted API backed by one Postgres. See §11.1 for what this decided and §11.2 for what it
> left open.

| Component | Decision | Reason |
|---|---|---|
| Storage | **Adopt:** Postgres + pgvector, **hosted, single engine** | One dependency, transactional, good enough for hybrid retrieval at our scale. Cognee validates "just Postgres." No SQLite: a hosted-only product has no second engine to keep in parity. |
| Graph / temporality | **Build thin, on Postgres** | Full graph databases are premature. Bi-temporal columns plus `supersedes` links cover the need. Revisit only if multi-hop reasoning becomes a bottleneck. |
| Durable execution | **Adopt if needed** (Inngest or Temporal) | Do not build. Only introduce when scheduled checkpoints and long jobs demand it, probably month 6+. |
| Embeddings | **Adopt:** provider API, pluggable | Keep the interface swappable; do not couple to one vendor. |
| Extraction / contradiction detection | **Build** | This is the product. Prompt engineering plus schema validation. |
| Rehydration ranking | **Build** | This is the product and the thing that improves with our data. |
| Agent orchestration | **Do not build. Do not compete.** | We sit beside LangGraph, CrewAI, Claude Code. Never above them. |
| Observability | **Do not build.** | Integrate with LangSmith / Langfuse later if asked. |
| Document indexing | **Do not build.** | That is Glean's job and it is a different business. |

**Language:** TypeScript for the MCP server and CLI (best MCP ecosystem support, easiest distribution via npm). Python bindings later if demand appears. Do not do both on day one.

### 11.1 Hosted-only: what it decided

```
  CLI ──┐
  MCP ──┤
  Web ──┼──►  Hosted API  ──►  Postgres + pgvector
Slack ──┘     (scope filter                (single store,
               applied here,                single authority)
               MNE-169)
```

**What this bought.** One store means every surface sees the same rows the moment they are written.
No sync protocol, no watermarks, no clock skew, no offline write queue, no cache invalidation, no
local-versus-hosted parity testing. An entire class of distributed-systems problems does not exist.

It also makes **CI runners first-class** rather than a special case — an ephemeral container with no
disk is just another authenticated client, which matters as more work is done by agents inside
pipelines.

And it makes installation *easier*, not harder: `sqlite-vec` is a compiled native extension, and
native modules are among the most reliable sources of cross-platform install failure. Install is now
pure JavaScript plus a login.

**What it cost.**

- **The hosted API moves to M1.** The CLI does nothing without it, so M1's success test now requires
  API, auth, database, and deploy — roughly double its original scope.
- **§15's "self-hostable, works fully offline" claim is no longer true** and has been rewritten
  rather than left standing.
- **MNE-50's "no content leaves the machine by default" is gone.** That promise was already in
  tension with the §8 arbitration-dataset moat; this resolves it in favour of the data. The privacy
  story is now about controls — scope enforcement, retention, residency — not about locality.

### 11.2 Open — infrastructure and logic

**These are not settled, and the sections that follow should be read as provisional where they touch
them.** All six are filed. **Items 1 and 3 are now ruled**; four remain open. Of those, two are strategy
and sit in S0; two are implementation and sit in M1, because they block MNE-42 and MNE-101 rather than
waiting on a business ruling.

Numbering is preserved after the ruling on purpose — other sections cite these by number.

| # | Question | Ticket | Why it matters |
|---|---|---|---|
| 1 | ~~Who pays for inference?~~ **RULED 2026-07-29: we do.** BYOK rejected on every tier — see §14.1. | MNE-174 ✅ | Settled the model, not the number. The allowance still has to be sized against measured cost (MNE-180). |
| 2 | **Does the CLI need a read cache after all?** | MNE-175 | Decided by whether hosted rehydrate can meet §12.1's 300ms p95. Currently an assumption, not a measurement. **Measure before building the cache** — a cache reintroduces exactly the staleness §11.1 was worth having for removing. |
| 3 | ~~Multi-tenancy model.~~ **RULED 2026-07-31: shared schema, `workspace_id` on every row, Postgres RLS mandatory.** See §11.3. | MNE-172 ✅ | Settled the model, not the enforcement. RLS and the cross-workspace invariant test are now hard gates on MNE-42 and MNE-44. |
| 4 | **Where embeddings are computed**, and by whom. | MNE-176 | Settled on *where* — server-side, at write time. Open on *which vendor*: Anthropic has no embeddings endpoint, so this is a separate procurement decision. |
| 5 | **Rate limiting and abuse.** A CI loop can call checkpoint indefinitely. | MNE-173 | Directly protects the margin in §14, and it is a hard gate on MNE-105. An unmetered public endpoint that runs inference on request loses money non-linearly. |
| 6 | **What "open source" now means** when the server is proprietary. | MNE-177 | §16's distribution depends on the answer being one the compaction-thread audience accepts. The risk is not being closed — it is being called out for describing closed as open. |

**Question 1 gated the other five, and the ruling went the expensive way.** Because we pay for inference,
none of the relief a BYOK answer would have provided arrives: **5 is the full margin guard rather than
ordinary read-path limiting, and it is now a hard gate on public install.** 4 keeps all of its cost
pressure. §14 carries variable COGS behind a flat seat price, which is exactly the configuration that
makes the §14.1 allowance the thing standing between us and a runaway CI loop.

That is the accepted cost of the simpler product. It is not a reason to relitigate it — it is a reason
MNE-173 and MNE-180 are both Urgent.

### 11.3 Multi-tenancy: what it decided

**Ruled 2026-07-31 (MNE-172), settling §11.2 question 3. Shared schema. Every row carries
`workspace_id`. Postgres RLS is mandatory, not a later hardening pass.**

Schema-per-tenant buys isolation by construction and an easier enterprise security questionnaire in
M5. It was rejected because it fights the product. §5 Stage 4's cross-team read path — the roadmap
lookup that answers "is anyone already building this" — is a requirement, not an edge case, and
schema-per-tenant makes exactly that query awkward. The migration runner iterating every tenant and
the connection-pool pressure past a few hundred schemas are real costs, but they are not the reason.

**What this obliges, on the first commit rather than a later one:**

- **`workspace_id` is not nullable on any §9 table.** No table gets an exemption, including join
  tables. A row that cannot name its workspace cannot be filtered and is a leak waiting to happen.
- **RLS policies ship in the same migration as the table** (MNE-42, MNE-43). A table that lands
  without its policy is a defect, not an increment.
- **The store interface enforces the filter** (MNE-44). RLS is the second layer, not the only one.
  Defence in depth here is the whole point: the interface catches the ordinary mistake, RLS catches
  the hand-written query.
- **MNE-169 gets an invariant test that proves a workspace cannot read another's rows even with a
  hand-written query that omits the filter.** This ranks with the two GUARD invariants. It is not
  satisfied by a test that goes through the store interface, because the interface is the layer being
  bypassed.

**The residency and isolation story for M5 is now a controls story**, consistent with the §11.1
rewrite of privacy. We answer isolation with RLS plus the invariant test, not with separate schemas.

**BYOC (MNE-147) is not this.** It is a third model — a dedicated deployment — and it stays the honest
answer for a customer who accepts neither shared schema nor our controls. Do not let it be offered as
a softener for this ruling.

---

## 12. Surfaces

### 12.1 MCP server tools

The primary distribution vehicle. Works in Claude Code, Cursor, Codex, and anything else MCP-capable.

| Tool | Purpose |
|---|---|
| `mneia_rehydrate` | Given the current task, return the context slice. Called at session start. |
| `mneia_assert` | Record a decision, constraint, open question, or fact mid-session. |
| `mneia_checkpoint` | Run the checkpoint pipeline for the session so far. |
| `mneia_handoff_create` | Produce the handoff artifact. |
| `mneia_handoff_receive` | Fetch and mark received. |
| `mneia_conflicts` | List unresolved conflicts for the project. |
| `mneia_search` | Direct query when the agent needs something specific. |

**Design rule:** `mneia_rehydrate` must be cheap and fast enough to call unconditionally at session start. If it is slow, nobody uses it and the whole product fails. Target p95 under 300ms.

### 12.2 CLI

```
mneia init                 # attach to a repo, create project, write .mneia/config
mneia brief                # print the rehydrated slice for a stated task
mneia checkpoint [-m msg]  # run checkpoint now, interactive confirm for load-bearing items
mneia handoff [--to @user] # generate handoff, print + copy link
mneia pickup [id]          # receive a handoff, print it, mark received
mneia conflicts            # list and resolve interactively
mneia log                  # decisions timeline for the project
mneia status               # what is stale, disputed, or unanswered
mneia login                # device-flow auth; writes a token to ~/.mneia/credentials
mneia whoami               # show the authenticated actor, workspace, and team
```

**Every command is an authenticated API call.** There is no `sync` — there is nothing to sync. A CI
runner authenticates with `MNEIA_TOKEN` instead of a browser flow; otherwise the surface is identical.

### 12.3 Surfaces, and the order they ship in

Every surface is a translation of the same verbs — rehydrate, assert, checkpoint, handoff, and from M4 conflicts. **If a surface needs a fifth verb, that is the signal it is becoming its own product rather than a view onto this one.** Treat that as a tripwire.

| Surface | Ships | Why |
|---|---|---|
| **MCP server** | M1 | The primary distribution vehicle (§12.1). Open source. |
| **CLI** | M1 | The human confirmation surface, and the one CI uses. Client is open source; it requires an account. |
| **Web** | **M1** | Thin (§4), in two parts. **Account plane** — signup, device-flow approval, workspace and project management (MNE-181); this is a hosted-only prerequisite, not a review surface. **Review app** — decision browser, review queue, decision timeline (MNE-25). Hosted, closed. |
| **Web — conflict resolution** | M4 | Stays with the conflict engine (MNE-23), not the web epic. §10.4's load-bearing case is human-versus-human; the screen is useless until two humans write to one project. |
| **Slack** | post-M4 | The non-engineering surface. Unlocks the Stage 4 question. Hosted, closed. |
| **VS Code extension** | **not planned** | MCP already runs inside VS Code, Cursor, and Codex — a developer there *already has* the tools. An extension adds chrome, not capability, at the cost of a marketplace presence and permanent API churn. Revisit only on repeated demand. |
| **Mobile** | **not planned** | No job to be done. Resolving a §10.4 conflict means reading two contradicting items with full provenance and writing a rationale; that is not a phone interaction. |

**Surfaces follow data, never lead it.** A Slack bot over an empty store answers nothing, and shipping one early converts a distribution advantage into a support burden.

> **Revised 2026-07-29 — web moved from M3–M4 to M1 by founder ruling.** CLI, MCP, hosted API, full web,
> and billing infra ship together rather than in sequence.
>
> Two honest notes on the trade. First, hosted-only (§11.1) had already forced part of this: `mneia login`
> is a device flow, a device flow needs a page to approve on, and nothing tracked that page until MNE-181.
> The old M3–M4 date described the *review app*, and quietly understated what M1 already required.
>
> Second, the rule above still bites on the rest. The review app has rows the moment anyone checkpoints
> once, so it is not a surface leading data. Conflict resolution is, which is why it stayed in M4. **The
> cost is concentrated in M1**, which had already absorbed the entire hosted API (MNE-171) and now carries
> the web app and billing too. §13's window for it moves accordingly — that is a real schedule cost, taken
> deliberately, not a free reshuffle.

### 12.4 File interop

- Read `AGENTS.md`, `CLAUDE.md`, `.cursor/rules` on `init` and import constraints from them. Meet people where they already are.
- Write a generated section back into `AGENTS.md` (clearly fenced, never clobber human-written content) so the value shows up even in sessions where the MCP server is not connected.
- `.mneia/config` in the repo holds the project binding — workspace, project slug, API endpoint. No
  data, no credentials. Credentials live in `~/.mneia/credentials`, outside the repo, and are never
  committed.

---

## 13. Roadmap

| Milestone | Deliverable | Success test |
|---|---|---|
| **Week 2–6** | **Hosted API, auth, and Postgres**, plus CLI + MCP server doing checkpoint and rehydrate against it. Works in Claude Code and Cursor. **Plus the web app — account plane and review app — and billing infra.** | The founder uses it daily on this repo and does not turn it off. |
| **Week 8** | Handoff artifact shipped. `AGENTS.md` interop. Metering and quotas enforced against a measured allowance. Published to npm and MCP registries. | 5 external people use it for a week without hand-holding. |
| **Week 14** | Provenance, freshness/decay, contradiction detection, `mneia status`. Public launch. | 100+ installs, measurable week-2 retention, first inbound "can my team use this." |
| **Month 6** | **Multiplayer.** Shared projects, invites, roles, conflict resolution UI, team handoffs. Team tier's feature table becomes true. | First paying team. This is the moat clock starting. |
| **Month 12** | Governance: SSO, audit export, permission scopes, BYOC. | First org-level contract. |

**Sequencing logic:** individual value first because it is the only thing reachable with no relationships. Multiplayer at month 6 and not later, because the moat does not start accruing until multiple actors write to one project. Governance last because it requires customers to exist first.

**Revised 2026-07-28:** the hosted-only decision (§11.1) moved the API, auth, and database from Week 6 into Week 2. Nothing works before the backend exists.

**Revised 2026-07-29:** the web app and billing infra moved from Month 6 into the first milestone (§12.3),
which is why it is now Week 2–6 rather than Week 2–3, and why everything after it shifts by roughly two
weeks. **Two things did not move: invites and roles (still Month 6, because that is multiplayer) and
conflict resolution UI (still Month 6, because it needs two humans to be worth opening).**

One consequence to hold onto: **billing plumbing existing in the first milestone is not the same as the
§14 Team tier being sellable.** Roles, conflict resolution, and team handoffs are all still Month 6, so most of what §14
lists under Team does not exist yet. What a paying customer gets before Month 6 — a thinner tier, an
early-access price, or plumbing that stays dark — is an open call tracked on MNE-26. Do not put up a
checkout page advertising §14's feature table before that table is true.

---

## 14. Pricing and packaging

| Tier | Price | Contents |
|---|---|---|
| **Solo** | Free | 1 project, 30-day history, capped checkpoints. Conversion funnel, not a business. |
| **Team** | **$24 per user per month** + included checkpoint allowance | Shared projects, roles, cross-team scope, conflict resolution UI, unlimited history, team handoffs, web review app. |
| **Enterprise** | Custom (target $15k to $60k ACV) | SSO/SAML, audit export, permission scopes, residency, BYOC or on-prem, support SLA. |

**Anchors this is set against:** Zep Flex around $25/month, Letta cloud $20 to $200/month, LangSmith around $39/seat plus usage, Mem0 free to $249/month. $24/user sits deliberately below the observability tools (we are not a replacement for those budgets) and above the hobbyist line (we are not a toy).

### 14.1 Metering — seats plus a checkpoint allowance

There is exactly one marginal cost worth metering:

| Action | Marginal cost | Metered |
|---|---|---|
| **Checkpoint** | The LLM extraction call — the entire cost | **Yes** |
| Contradiction detection | Small, higher-tier model | Rolled into checkpoint |
| Rehydrate | One indexed query. Fractions of a cent. | No |
| Handoff, log, status, search | Negligible | No |
| Storage | Meaningful only at extremes | Only as a fair-use ceiling |

**Structure:** seat price with a generous included checkpoint allowance, then overage. Set the
allowance at several times typical use so ordinary customers experience it as seat pricing and never
think about it, while a runaway CI loop cannot quietly invert the margin.

**Convenient consequence:** §17's event spine *is* the metering spine. `checkpoint.item_extracted`
already fires per checkpoint for the arbitration dataset. One system, two purposes — do not build a
second.

> **Ruled 2026-07-29 (MNE-174): we pay for inference. BYOK is rejected, on every tier.**
> Asking a customer for $24/seat *and* their own Anthropic key funds the product twice and puts our
> COGS on their monthly bill. Owning the call also keeps prompt caching and the Batches API discount,
> both of which require the call to be ours, and keeps one credential path instead of two.
>
> So these economics are the real ones: the seat price carries variable cost, which makes the included
> allowance load-bearing rather than a formality. **What is still open is the number, not the model** —
> the allowance has to be sized against measured checkpoint cost from the MNE-86 dogfood (MNE-180),
> and the $24 should not be treated as load-bearing until that lands.

**Do not** charge for the solo tier. Developers do not pay for tools they can replace with a markdown
file, and the solo tier's job is distribution, not revenue.

---

## 15. Open source and licensing

> **Rewritten 2026-07-28.** The previous version promised a *"self-hostable open core"* that
> *"works fully offline."* Hosted-only (§11.1) makes both untrue. Claiming them anyway in a README
> that §16's audience will read closely is worse than claiming less.

**What is open, under Apache 2.0:**

- `@mneia/cli` and `@mneia/mcp-server` — the client surfaces
- `@mneia/core` — the schema definitions, the handoff format, the extraction prompts, the §10.2
  ranking algorithm
- The handoff spec itself, when §16 item 5's condition is met

**What is proprietary:** the hosted API, the store, multiplayer, conflict resolution UI, permissions
and roles, audit and governance, and the web app. **The clients require an account and do not
function without the service.**

**Say that plainly.** Do not describe Mneia as self-hostable until BYOC (MNE-147) actually ships, at
which point it becomes true for enterprise customers under a commercial licence.

**What the licence still buys.** Less than the original section claimed, and the difference matters:

- The parts that carry our judgement — extraction prompts, ranking weights, the handoff format — are
  inspectable, forkable, and criticisable. That is a real invitation to the practitioners in §2.2 who
  built their own versions, and a real constraint on us to make them defensible.
- No Elastic-License redistribution restrictions on the client, so it can be packaged, wrapped, and
  embedded freely.

**What it no longer buys.** A meaningful self-host story, and therefore most of the licensing wedge
against Byterover described in §6.1. That wedge is now smaller and should not be leaned on in
positioning.

> **Open, and the sharpest unresolved question in the brief (§11.2 item 6).** §16's distribution plan
> targets people who hand-rolled their own memory tools *specifically because they wanted something
> they controlled.* "Sign in to use it" lands differently with that audience than with any other.
> Vercel, Sentry, and Linear all ship account-required CLIs successfully — but none of them recruited
> their first thousand users from a thread about not trusting a vendor with your context.

---

## 16. Distribution

Zero budget, zero relationships. The artifact is a working tool, not a landing page.

1. **npm + MCP registries** (Anthropic's connector directory, Smithery, Cursor's directory). Lowest friction install path.
2. **Show HN** at week 12, once retention is real. Lead with the compaction pain and the handoff artifact, not with "AI memory."
3. **Reddit:** r/ClaudeAI, r/cursor, r/LLMDevs, r/AI_Agents, r/ExperiencedDevs. Post in the existing complaint threads about context loss and compaction. Do not spam; answer the specific problem.
4. **GitHub issue engagement:** the `anthropics/claude-code` compaction threads are full of people who built worse versions of this. That is the highest-intent audience that exists.
5. **Write the spec.** Publish the handoff format as an open spec with our reference implementation. This is a standard-setting play; it only creates advantage if we own the canonical implementation and the early adopters, so publish it *after* we have both.

**First 100 users:** MCP registries plus one Show HN. **First 1,000:** word of mouth plus the Reddit and GitHub threads.

---

## 17. Instrumentation (non-negotiable, from commit one)

**This is the moat. It cannot be retrofitted, because a year of unlogged usage is a year of lost training data.**

Every one of these events must be captured, with actor, project, timestamp, and item ids:

| Event | Why it matters |
|---|---|
| `rehydration.slice_shown` | The denominator for slice quality. |
| `rehydration.item_referenced` | Which items actually got used. Ground truth for ranking. |
| `rehydration.item_ignored` | Negative examples. Equally valuable. |
| `checkpoint.item_extracted` | Extractor precision. |
| `checkpoint.item_confirmed` / `edited` / `rejected` | Human correction signal. The core dataset. |
| `conflict.detected` / `resolved` | **Which side a human chose, and why.** Nobody else is collecting this. |
| `item.superseded` | Decision evolution over time. |
| `handoff.created` / `received` | Adoption of the differentiating feature. |
| `handoff.time_to_first_action` | Does the handoff actually reduce pickup cost? The product's core claim. |

**North-star metric:** percentage of rehydrated items that get referenced. If this climbs over time on a per-team basis, the moat is real and compounding. If it stays flat, we are a nicer markdown file.

**Business metrics that decide funding:** individual-to-team conversion rate, and teams still active at month 6.

---

## 18. Risks and kill criteria

| Risk | Leading indicator | Kill criterion |
|---|---|---|
| **Developers cope with free markdown and never pay.** The biggest risk by far. | Individual users inviting teammates | Under 1% individual-to-team conversion after 12 months with meaningful top of funnel. |
| **Model providers bundle it.** | Anthropic or OpenAI shipping *cross-vendor, multi-human* shared project memory | A provider ships neutral multi-vendor multi-human handoff. Pivot to governance or stop. |
| **It is a feature, not a company.** | Cursor or Claude Code shipping shared team memories with roles | Two major vendors ship native multiplayer project memory. |
| **Byterover outruns us.** | They ship conflict resolution and relicense permissively | They reach team traction first with feature parity. Then only switching cost saves us, and we will not have accrued any. |
| **Workflow change is too costly.** | Week-2 retention of the checkpoint habit | Retention collapses after week 2 in every cohort. |

**The one to watch above all others:** individual users pulling teammates in. Feature parity with Byterover is survivable. A pain that is annoying but not paid-acute is not.

---

## 19. Non-goals (do not build these)

Explicitly out of scope. If a feature request falls here, the answer is no.

- Agent orchestration or a runtime. We sit beside frameworks, never above them.
- Observability, tracing, or evals. Integrate, do not rebuild.
- Enterprise document search. That is Glean's business.
- A chat interface or an agent of our own.
- Durable execution infrastructure.
- Model hosting or inference.
- A vector database. We use one.
- Support for every framework on day one. MCP plus CLI covers the ecosystem.

---

## 20. Open decisions

Things not yet settled. Resolve deliberately, do not drift into them.

1. ~~**Name.**~~ **RESOLVED 2026-07-28: Mneia.** The company and the product both. npm scope, GitHub org, and domain still need reserving before the name goes into code — tracked as MNE-33.
2. ~~**Local store default.**~~ **RESOLVED 2026-07-28: hosted Postgres only, no local store.** See §11.1. The follow-on infrastructure questions this opened are listed in §11.2 and are the next thing to settle.
3. **Pre-compaction hook:** does Claude Code expose one? If yes, checkpointing right before compaction is the single highest-value trigger and should be prioritized.
4. **Should `AGENTS.md` write-back be default-on?** It gives value without the MCP server connected, but writing to a user's repo by default is invasive.
5. **Vertical wedge:** stay horizontal, or lead with long-running migrations and large refactors specifically? A vertical story makes the pitch sharper but narrows early adoption.
6. **Co-founder profile:** distribution and developer-relations, not a second backend engineer. The technical seat is filled. Start looking during the launch milestone, recruit from the responding community.
7. ~~**Who pays for inference.**~~ **RESOLVED 2026-07-29: we do. BYOK rejected on every tier.** See §14.1 and MNE-174. The seat price carries variable COGS, so MNE-173 (rate limiting) and MNE-180 (measure the allowance) are both Urgent consequences rather than follow-ups.
8. ~~**When the web app ships.**~~ **RESOLVED 2026-07-29: with CLI, MCP, and the hosted API in the first milestone**, not at Month 6. See §12.3. Invites, roles, and conflict resolution UI stay at Month 6 — they are multiplayer, not web.
9. **What a paying customer gets before Month 6.** Billing plumbing now exists in the first milestone, but most of §14's Team tier — roles, conflict resolution, team handoffs — does not. Thinner tier, early-access price, or dark plumbing? Tracked on MNE-26. **Do not ship a checkout page until this is answered.**
10. ~~**Multi-tenancy model.**~~ **RESOLVED 2026-07-31: shared schema, `workspace_id` on every row, RLS mandatory.** See §11.3 and MNE-172. Schema-per-tenant was rejected because §5 Stage 4's cross-team read path is a product requirement it fights. The consequence is that RLS policies and MNE-169's cross-workspace invariant test are hard gates on MNE-42, MNE-43, and MNE-44 rather than follow-ups.

---

## 21. References

- Chroma, "Context Rot: How Increasing Input Tokens Impacts LLM Performance" (Hong, Troynikov, Huber, July 2025)
- Modarressi et al., "NoLiMa: Long-Context Evaluation Beyond Literal Matching," ICML 2025
- Liu et al., "Lost in the Middle: How Language Models Use Long Contexts"
- Cognition, "Don't Build Multi-Agents" (Walden Yan)
- Anthropic, "Effective context engineering for AI agents"
- `anthropics/claude-code` GitHub issues on compaction and context loss
- Model Context Protocol specification and registry
- Competitor documentation: Byterover/Cipher, Mem0, Zep/Graphiti, Letta, Supermemory, Cognee, LangGraph persistence

**Note on figures:** competitor funding amounts, benchmark scores, and traction numbers cited during research come from a mix of primary announcements and aggregators, and several are vendor-reported and unreplicated. Verify anything before it goes into a pitch deck or a public comparison page.

### open-question
 how about this we will divide Mneia in to parts Individual, Team, across team and repo levels and main company level. we will divide in a few ways set it up with logic builting around if it has anything do bug/debug goes with individual, team level and the team leader will decide is it worth going into other categories, if anything about new feature/building existing ones same individual, team, across team, particular repo level, and company level, if working on client side request by solution engineer/fde then individual, teAM level and upto team leader, same with other teams like marketing, accounting, operations, product, customer support, customer success managers/team, sales and different tech team according to the company and according to the seat they wanna purchase. because accounting, sale marketing and others does use claude code and vibe code things out but they don't wanna know where's the bug what caused it how we're fixing it it doesn't make sense that they should know or their AI needs to know this. But if a sales person have a meeting and some customers/client says I wish you had this feature then that sales exec asks Mneia through (slack or CLI or idk what we have think of here in terms of integration) and asks Mneia if we have this or not and it check all the context accross the level and see it's on the roadmap or this team is building and that's their progress and point of contact with the team. something like this!