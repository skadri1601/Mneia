# Three lanes — 2026-08-16 → 2026-09-01

Three agents work this repo in parallel: **Claude session A**, **Claude session B**, **Codex**.
This file is the split. Read your lane, then read §6 Collision rules before touching a file.

## 0. Where you work — one worktree per lane, already created

**There are exactly four worktrees, and creating a fifth is blocked.** Go to your lane's:

| Lane | Worktree | Branch |
|---|---|---|
| **A** | `.claude/worktrees/lane-a-handoff` | `feat/mne-89-handoff-artifact` |
| **B** | `.claude/worktrees/lane-b-account` | `feat/mne-181-multi-workspace` |
| **C** | `.claude/worktrees/lane-c-billing` | `feat/mne-141-checkout-and-quota` |

The fourth is the primary checkout at the repo root, which **stays on `main`** — do not take it for a
lane and do not commit code there, only docs.

All three are synced to `origin/main`, have `node_modules` installed, and are gitignored
(`.gitignore:27`). **Their upstream is deliberately unset**, so your first push must be explicit and
cannot land on `main` by accident:

```
git push -u origin <your-branch>
```

### Do not create another one

Twenty stale worktrees were removed on 2026-08-16 — several holding uncommitted work nobody was ever
going to finish, and every one of them a full `pnpm install` on disk. `.claude/hooks/worktree-guard.mjs`
now refuses `git worktree add` and the `EnterWorktree` tool, and names these three in the refusal.

If your work genuinely does not fit a lane, **say so and let the founder decide** rather than
creating one. Real exception: prefix `MNEIA_WORKTREE_GUARD=off` and justify it.

Each lane's work spans several tickets. Branch names carry the first; put the rest in the commit
subject (`MNE-89, MNE-94: …`) and the PR body (`Closes MNE-89`, `Part of MNE-181`).

A worktree does **not** share `node_modules`, `.env`, or `.mneia/` with the others. Copy `.env` in
yourself — it is gitignored and it is what `pnpm test` and `pnpm db:migrate` read.

---

## 1. The frame — what makes this a company

`docs/BUSINESS.md` already says the uncomfortable part, and it is the thing to keep on the wall:

> *"Any one of our five differentiating features can be built by a funded team in a quarter.
> Features get the first thousand users. The moat is switching cost plus the arbitration dataset."*

The feature-shaped version of Mneia — *"remember things across sessions"* — is already shipped by
every harness as `CLAUDE.md`, Cursor rules, and vendor memory. **Single-player recall is not the
product and must not be what we optimise.** Three things a competitor cannot copy by shipping the
same features, and each lane owns one:

| Moat | Why nobody else builds it | Lane |
|---|---|---|
| **Handoff** | It is the operation that only exists when work crosses *people*. Vendors optimise the single-user loop; a handoff artifact presumes a team and a receiver. | **A** |
| **Switching cost** | Accrues only once we are the system of record for a *team's* decisions. Needs multiplayer that works, not a better ranker. | **B** |
| **Arbitration data** | Presumes agents are wrong. No model vendor ships a product built on that premise, and it is not retrofittable. | **C** |

---

## 2. Ground truth — the board, the ROADMAP, and AGENTS.md are all stale

**Read this before picking up any ticket.** Verified against `git log origin/main`, 2026-08-16.

Linear shows these `In Progress` and `ROADMAP.md` shows them unchecked. **All merged:**

| Ticket | Merged as |
|---|---|
| MNE-268 §17 telemetry has no writer | `8015cb1`, `1594cef` (#102) — `telemetry_event` has a Postgres sink |
| MNE-274 any member can invite an owner | `9c75675` (#91) |
| MNE-51 write-path emit coverage test | `b0bbf32` (#93) — fails CI now |
| MNE-60, 61 dedupe + contradiction detection | `634ea14` (#100) |
| MNE-66 extractor quality metric | `634ea14` — `pnpm dogfood:report` |
| MNE-73 rehydrate p95 | `0947d0f` (#101) |
| MNE-138, 139, 140 browser, review queue, timeline | `634ea14`, `4f55917` |
| MNE-141, 142, 143 Stripe plumbing, seats, funnel | `634ea14` |
| MNE-173 rate limiting | `634ea14` |
| MNE-252 invitation email | `5b5d823` (#107) |

**`AGENTS.md:77-88` is also wrong.** It says both MNE-265 defects are open. Both were closed by
`915685c` (#96) on 2026-08-08: the server disables the reducer cap (`propose.ts:116`), chunks via
`packages/core/src/extract/chunk.ts`, and advances the watermark only after a chunk parses
(`propose.ts:175`). `contextTokens` **is** read — four sites in `extraction/select.ts`. Covered by
`propose.test.ts:262-372` and `select.test.ts:160-182`. **Do not re-fix them.**

`0.2.0` of all three clients is live on npm. Production: `rls: enforced`, `schemaVersion 29/29`,
`telemetry: persisted`, all three model keys `configured`.

**Never trust a Linear status or a ROADMAP checkbox.** Run `git log origin/main --grep=MNE-nnn`
first. Finding a shipped ticket and closing it is real work, not overhead.

### What actually runs

Checkpoint and rehydrate are **shipped end-to-end** — 7 real CLI commands, 4 real MCP tools, and
every web route reads live Postgres with no mock data anywhere. The single-player loop is done.

**The five places it breaks are the whole of this document:**

1. **Handoff does not exist above the database.** → Lane A
2. ~~A person can belong to only one workspace.~~ **Fixed, PR #117.** The real defect was narrower
   than this line said — see §4 B1. → Lane B
3. ~~Signup needs manual admin approval.~~ **False.** Clerk's sign-up mode is `public` with no
   allowlist; self-serve has been open all along — see §4 B2. → Lane B
4. **Nobody can pay you** — no checkout, no portal, no enforcement, no quota. → Lane C.
   **Now the most urgent item on this page**, because #3 means the free door is already open.
5. **A partial extraction is invisible to §17.** → Lane C

---

## 3. Lane A — Claude session A — *handoff, the operation that makes this multiplayer*

**Owns:** `packages/core/src/handoff/**` (new) · `packages/core/src/api/remote-store.ts` ·
`packages/cli/src/**` · `packages/mcp-server/src/**` · `apps/web/src/app/api/v1/handoff*`

`vision.md` names three operations. Two ship. **The third exists only as a table.**

- Table and adapter are real: `0006-checkpoint-handoff.ts`, `0024-handoff-item.ts`, and
  `postgres.ts:1262/1287/1329` (`createHandoff`, `receiveHandoff`, `getHandoff`)
- Telemetry events already declared: `packages/core/src/telemetry/types.ts:15-17`
- **Everything above the database is absent.** `packages/core/src/api/remote-store.ts:210-217`
  returns `unsupported('createHandoff', 'M2')` for all three — the only real stub in the repo. No
  renderer, no API route, no CLI command, no MCP tool.
- **`apps/site/src/app/handoff/page.tsx` markets it anyway.** That is a live inaccuracy on a
  published page, and it is the sharpest gap between what we promise and what runs.

### A1 — MNE-89 · The renderer — the eight sections
The `rendered` column is required and non-empty with nothing to populate it. There is no
`packages/core/src/handoff/` directory. This is the actual product: a **receivable artifact** — what
was decided, what is still open, what constrains the receiver. **MNE-89 already specifies the eight
sections — build to that ticket, not to your own taste.** MNE-97 (format spec v0) is the written
form, and standing rule 8 says it stays **internal**: do not publish the spec until we own the
reference implementation and the early adopters. We do not yet own either.

### A2 — MNE-94, MNE-93 · The surfaces
The API route, `mneia handoff` / `mneia pickup` (refused today at `router.ts:18-23`), and
`mneia_handoff_create` / `mneia_handoff_receive` (refused at `registry.ts:14`). Replace the refusals
— do not leave a refusal beside a working path. `MNE-96` instruments
`handoff.time_to_first_action`; the event is already declared in `telemetry/types.ts:15-17`, so this
is wiring, not a new event name.

### A3 — MNE-265 · the client-side residual
`packages/cli/src/http-api.ts:251` still calls `reduceTrajectory(trajectory)` with **no options**, so
the 700,000-char cap is live before upload and those turns are lost permanently. The product says so
itself at `checkpoint.ts:547-549`. **The server now takes the whole transcript, so the client cap
buys nothing.** Match `propose.ts:116` and add a test that the turns arrive — `checkpoint.test.ts:489`
only asserts the warning renders, which pins the loss rather than fixing it.

> ⚠️ **A1 and A2 are M2 work pulled ahead of the M1 gate.** M1 closes on the founder using it daily
> and MNE-88 is the go/no-go. Building handoff now jumps that queue. It is on this list because it is
> the differentiator and because the site already sells it — **but confirm before starting A1/A2.**
> A3 is unambiguously M1 and needs no ruling.

---

## 4. Lane B — Claude session B — *make the team motion actually work*

**Owns:** `apps/web/src/server/{account,current-account,admission}.ts` ·
`apps/web/src/app/{team,join,welcome,device,admin}/**`

Invites, roles, RLS scoping and redemption are all built and hardened. **Two constraints make the
team story undemonstrable anyway**, and one of them will break the first evaluator who tries.

### B1 — DONE, PR #117 — a person could not stay in a second workspace

> **Corrected 2026-08-16, against a `pgvector/pgvector:pg18` container.** The paragraph that stood
> here said the invite *fails*. **It does not.** Redemption succeeded at the store layer all along.
> What failed was the request *after* it: `bootstrapSoloAccount` ordered candidate actors
> `created_at ASC` and took the first, which for a solo-first evaluator is the empty workspace they
> signed up in — so they were returned there on the next page load. Nothing wrote the selection
> cookie on acceptance, and `acceptInTransaction` returned only the joined workspace, so
> `WorkspaceSwitcher` hid itself (`< 2`) on exactly the render where it was needed. The user-visible
> symptom matched the description; the mechanism did not. The `/join` page's claim that "a person can
> be in one workspace at a time" was stale copy, not an enforced constraint, and is gone.

The substrate defect was real and is fixed: `bootstrapSoloAccount` created `workspace`, `actor`,
`team`, `team_member` and **no `identity`, no `workspace_member`**, leaving `actor.identity_id` NULL.
Measured after two solo signups: 0 identity rows, 0 membership rows. Migration 0017 backfilled only
the workspaces that existed when it ran.

**Two commits on PR #117.** The first fixes the writer and the landing behaviour — no schema change.
The second is **migration 0030**: it backfills `identity`, `actor.identity_id` and `workspace_member`
for every account created between 0017 and now, deriving the role rather than guessing it (earliest
human in a workspace is `owner`, another `lead` is `admin`, everyone else `member`, and
`ON CONFLICT DO NOTHING` preserves whatever an invitation granted). It then adds a CHECK so a human
actor carrying an `external_ref` must carry an identity — narrow on purpose, so agent actors and
identity-less seed-harness humans stay legal.

⚠️ **Deploy order: apply 0030 only after the app from PR #117 is live.** Against the currently
deployed code the constraint rejects every new signup.

### B2 — WRONG PREMISE. Self-serve signup is already open, and has been.

> **Checked 2026-08-16 against the live instance**, not against the code's intent:
>
> ```
> curl -s "https://clerk.mneia.dev/v1/environment?__clerk_api_version=2025-04-10&_clerk_js_version=5.0.0"
> ```
>
> `user_settings.sign_up.mode` is **`public`**. `restrictions.allowlist.enabled` is **false**.
> `restrictions.blocklist.enabled` is **false**.

There is no human in the loop and no ceiling on MNE-108. Every link in the chain is already open:

- `middleware.ts` lists `/sign-up(.*)` as a **public route**
- `sign-up/[[...sign-up]]/page.tsx` renders Clerk's stock `<SignUp />`
- `resolveCurrentAccount` goes straight to `bootstrapSoloAccount` — **there is no waitlist check
  anywhere in the account path**, and no Clerk webhook exists to add one
- every marketing page already says **"Start free"** and links to `app.mneia.dev`

The waitlist and `/admin` are a **proactive invite path**, not a gate: `admission.ts` mints a Clerk
invitation and emails it so you can reach out to someone. Nothing stops a stranger signing up
without one. The only friction is Clerk's captcha, required legal consent, and the MNE-250 verified-
email requirement — which is friction, not admission control.

**So the exposure in §5 C1 is live now, not a future risk.** Anyone can sign up today and burn
inference we pay for, and `workspace.checkpoint_allowance` is written `null` and read by nothing.
The founder was asked on 2026-08-16 whether to open self-serve ahead of quota and said open it and
accept the exposure — that ruling stands, but it describes the *existing* state rather than a change.
**Lane C's quota is the only thing between us and unbounded spend.**

### B3 — DONE, PR #117 — API token management

`api_token` had exactly one toucher: `PostgresDeviceStore`, which inserted on redeem and stamped
`last_used_at` on identify. No read path, no revoke path, no surface — **a token, once issued, was
permanent and invisible.**

`/tokens` now lists every live token with holder, created, last used, expiry and scopes, and revokes
one in place. You may revoke your own always, anyone's if you are a lead; the check runs before the
store is reached. Two GUARDs: a revoked token stops identifying its caller, and a second workspace
can neither revoke nor **see** the row.

**No §17 event, and that was a ruling, not an oversight.** The spine names no administrative event
and §6 below forbids adding one. This is control-plane — exactly like `createProject`, which MNE-51's
coverage test already exempts for that reason. That test governs `ScopedStore`; this store is not
part of it.

**`audit_event` still has zero writers** — it landed in migration `0028` and nothing has ever written
to it. "Who revoked this token, and when" deserves an answer and that table exists for it. Left out
deliberately rather than answered halfway; worth picking up.

> B1 likely needs a schema change. **Stop and use plan mode + the `db-migration` skill** — and see
> §6: a migration serialises all three lanes.

---

## 5. Lane C — Codex — *make it possible to pay, and see what the extractor dropped*

**Owns:** `apps/web/src/server/billing/**` · `apps/web/src/app/api/stripe/**` ·
`apps/web/src/app/billing/**` (new) · `apps/web/src/server/api/{handlers,review,propose}.ts`

### C1 — MNE-141, MNE-178 · There is no way to give us money
~1,245 lines of real Stripe plumbing exist and are correct: webhook signature verification,
`SEAT_PRICE_USD_CENTS = 2400`, seat math, plan mapping, and the out-of-order-event guard that stops a
cancelled workspace being revived. **The half that takes money is missing entirely:**

- **No checkout session anywhere.** `createCheckoutSession` / `checkout` has zero hits in
  `apps/web/src` outside comments. The webhook can only receive events for a subscription created by
  hand in the Stripe dashboard.
- No billing portal link and no `/billing` page.
- **No enforcement.** Nothing reads `plan`, `billingStatus` or `seatsPurchased` to gate anything.
  `seatsRequiredFor` is defined and never called from a write path.
- **No quota.** `workspace.checkpoint_allowance` is written `null` and read only in test fixtures.

A team can use it indefinitely, free, and there is no button to pay. `docs/BUSINESS.md` says *"we pay
for inference"* — so unmetered free use is a **direct margin leak**, not just absent revenue.

**MNE-178 is the quota half, and it names where quota belongs: on the §17 event spine.**
`docs/BUSINESS.md` is explicit — *"exactly one thing is worth metering: the checkpoint"*, because the
LLM extraction call is the entire marginal cost; and *"the §17 event spine is the metering spine …
one system, two purposes — **do not build a second.**"* `checkpoint.item_extracted` already fires per
checkpoint. Meter off that, not off a new counter.

**Two constraints that are not yours to relax:**
- **Standing rule 7 — do not charge for the individual tier.** Checkout is for the team tier only.
- **Do not advertise the Team tier's feature table before it is true.** Roles and team handoff are
  Month 6. Billing plumbing existing is not the tier being sellable.

### C2 — MNE-268 · a partial extraction is invisible
`droppedTurns`, `splitTurns`, chunk count and `incompleteReason` are computed and **reach no §17
event** — they appear only in the HTTP response body. A checkpoint that silently covered half a
session is indistinguishable from a clean one in the stream the arbitration dataset is built from.

The propose path emits no §17 event at all. Also check `emitQuietly` (`handlers.ts:44-48`,
`review.ts:18-22`), which swallows sink failures — telemetry can be failing in production silently.

**Do not add, rename, or remove an event name.** Carry this on the existing
`checkpoint.item_extracted` payload. `634ea14` added no new names on purpose: MNE-51's coverage test
is what makes standing rule 5 real, and a new name weakens it.

### C3 — Correct the stale record
`AGENTS.md:77-88` describes both MNE-265 defects as open and claims `contextTokens` is read by
nothing. Both false — see §2. Docs lane, commit direct to `main`.

**Why this lane is yours:** bounded, verifiable, and correctness-critical — the shape you did well on
the MNE-271 harness, and you found the Stripe ordering bug in `634ea14`'s review. Read **`CODEX.md`
first**: `.claude/rules/` does **not** auto-load for you.

---

## 6. Collision rules

| Lane | May write | Must not touch |
|---|---|---|
| **A** | `packages/core/src/handoff/**`, `remote-store.ts`, `packages/cli/**`, `packages/mcp-server/**`, `api/v1/handoff*` | `apps/web/src/server/{billing,account,current-account,admission}`, `apps/web/src/app/**` |
| **B** | `apps/web/src/server/{account,current-account,admission}.ts`, `app/{team,join,welcome,device,admin}/**` | `packages/**`, billing, `app/projects/**` |
| **C** | `apps/web/src/server/billing/**`, `app/api/stripe/**`, `app/billing/**`, `server/api/{handlers,review,propose}.ts` | `packages/cli`, `packages/mcp-server`, `app/team`, `app/join` |

- **Nobody adds a §17 event name.** Emit through the existing emitter or raise it in this file.
- **A migration serialises everyone.** B1 probably needs one. Announce it before writing it, use plan
  mode and the `db-migration` skill, run `pnpm db:snapshot`, and commit `db/structure.sql` in the
  same commit. **The other two lanes rebase on `main` after it lands** — do not carry a stale schema
  into a PR, because `pnpm db:snapshot --check` will fail it in CI.

  > 🔴 **This has happened. Migration `0030` is on PR #117** (schema version 29 → 30). **A and C:
  > rebase on `main` once it merges** — a PR carrying version 29 fails `db:snapshot --check`.
  > **The next free migration version is `0031`.** PR #117 also writes under
  > `packages/core/src/store/migrations/`, outside Lane B's boundary below; a migration has nowhere
  > else to live.
- **Stay in your worktree** (§0). Do not `git checkout` another lane's branch — it is checked out
  elsewhere and git will refuse, which is the guardrail working. Rebase on `origin/main` rather than
  merging between lane branches.
- **Clean up when your PR merges**: `git worktree remove .claude/worktrees/<yours>`.
- `apps/site/src/content/legal.ts` is **published legal copy**. Lane C's checkout touches Stripe,
  already disclosed as a subprocessor — verify rather than assume, and flag it loudly in the PR.

## 7. Shared constraints

- **Linear cannot accept new issues** (free plan limit). Reuse the numbers above; new findings go in
  a **comment** on the closest ticket plus a pointer here. The git-lane hook rejects any commit
  message with no `MNE-nnn`.
- **Ask before**: production deploy, migrating production, `push --force`, `reset --hard`, history
  rewriting. Commit, push a branch, open a PR, deploy a preview — all pre-authorised.
- **`pnpm build` typechecks zero app code.** Run `pnpm -r build`. The web build needs a Clerk key
  locally — use a dummy so you can tell your bug from a missing env.
- `pnpm test` needs a **direct** `DATABASE_URL`, not `-pooler`. Without it the integration suites
  skip silently, which looks exactly like a pass.
- **Do not restate revoked promises**: self-hostability, offline operation, "content never leaves
  your machine." Hosted-only since 2026-07-28; privacy is enforced by controls, not locality.

## 8. What no lane can do

**MNE-86 — the 7-day dogfood — is founder work and cannot be delegated.** No agent satisfies *"the
founder uses it daily on this repo and does not turn it off."* M1 does not close without it, and it
closes on **2026-09-01**.

**Two rulings are also founder-only, and both are blocking:**

- **§12.1's 300ms budget is not met.** `docs/REHYDRATE-LATENCY.md` measures 146ms store + 187ms
  network = **333ms p95** and names the choice — restate the budget, cache, or miss it — as a founder
  call, because §12.1 is a published promise. Standing rule 4 is unmet until it is made. The
  authenticated path has still never been measured; that number should come first.
- **$24/seat is unvalidated.** `634ea14` measured the token spread and *deliberately refused* to
  convert it to money, because no contracted per-token rate is in this repo and a guessed price is
  worse than none. `docs/BUSINESS.md` still says *"treat the number as provisional."* Lane C's
  checkout page will price something — that number needs to be real before it does.
