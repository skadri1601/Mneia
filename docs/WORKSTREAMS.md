# Two lanes — 2026-08-18 → M2

Supersedes the three-lane split of 2026-08-16, which is finished: everything it assigned to lanes B
and C has merged, and lane A's premise — *handoff does not exist above the database* — is still true
and is now the whole of lane A.

Two agents work this repo in parallel: **Claude session A** and **Claude session B**. This file is
the split. Read your lane, then read §5 Collision rules before touching a file.

---

## 0. Ground truth — what is actually left

**Verified against `origin/main` and Linear on 2026-08-18.** Never trust a Linear status or a
`ROADMAP.md` checkbox without running `git log origin/main --grep=MNE-nnn` first.

### M1 is not "left" in the way the board implies

Fourteen M1 tickets showed `In Progress` or `Backlog` while their work sat merged on `main`. They
were closed on 2026-08-18: MNE-60, 61, 66, 80, 138, 140, 141, 142, 143, 178, 250, 252, 254, 268.
**MNE-274 could not be closed from the session and needs closing by hand** — it merged in `9c75675`.

After that reconciliation, **M1's remaining work is almost entirely the founder's**:

| Left in M1 | Who | Why it cannot be delegated |
|---|---|---|
| MNE-86 — the 7-day dogfood | **Founder** | *"The founder uses it daily on this repo and does not turn it off."* No agent satisfies that clause. |
| MNE-87 — friction log | **Founder** | Written from the dogfood run |
| MNE-88 — GATE, go/no-go on M2 | **Founder** | A ruling |
| MNE-180 — size the §14.1 allowance | **Founder** | `634ea14` measured the token spread and deliberately refused to price it; no contracted per-token rate exists in this repo |
| §12.1's 300ms budget | **Founder** | `docs/REHYDRATE-LATENCY.md` measures **333ms p95**. Restate, cache, or miss it — §12.1 is a published promise, so standing rule 4 is unmet until this is ruled |
| $24/seat | **Founder** | `docs/BUSINESS.md` still says *"treat the number as provisional"*, and checkout now prices something |

**Exactly two M1 items are agent-actionable, and both are lane B's** — see §3, B0.

### M2 is unbuilt above the database

- The tables and adapter are real: `0006-checkpoint-handoff.ts`, `0024-handoff-item.ts`, and
  `postgres.ts` (`createHandoff`, `receiveHandoff`, `getHandoff`)
- Telemetry event names are already declared: `packages/core/src/telemetry/types.ts:15-17`
- **Everything above the database is absent.** There is no `packages/core/src/handoff/` directory.
  `packages/core/src/api/remote-store.ts:228-236` returns `unsupported('createHandoff', 'M2')` for
  all three — the only real stub left in the repo. No renderer, no API route, no CLI command, no MCP
  tool. `packages/cli/src/commands/` has no `handoff.ts` or `pickup.ts`.
- **`apps/site` markets it anyway** — `apps/site/src/content/docs/handoff.ts` is live copy for a
  thing that does not run. That is the sharpest gap between what we publish and what exists.

> ⚠️ **MNE-88 is the gate on opening M2 and it has not been run.** Building M2 now jumps that queue.
> The founder directed both lanes to start M2 on 2026-08-18 — that is the confirmation §3 of the
> previous split asked for. **The gate still needs running**; starting M2 does not retire it.

---

## 1. The split

`docs/BUSINESS.md`: *"Any one of our five differentiating features can be built by a funded team in a
quarter. Features get the first thousand users. The moat is switching cost plus the arbitration
dataset."* M2 is the milestone where the first of those stops being a table.

| Lane | Owns | Epics |
|---|---|---|
| **A** — session A | **Handoff.** The operation that only exists when work crosses *people* | MNE-14 |
| **B** — session B | **The M1 tail, then interop and distribution.** Everything that decides whether a stranger can install it and get value on day one | MNE-15, MNE-16, MNE-17 |

Handoff is one coherent artifact with a renderer, two surfaces, and freeze semantics — splitting it
across two agents would put two people in the same new directory. Lane B's items are independent of
each other and of handoff, which is what makes them parallelisable.

## 2. Where you work

**Three worktrees exist and creating a fourth is blocked** by `.claude/hooks/worktree-guard.mjs`.
`git worktree list` is the inventory; trust it over this table if they disagree.

| Lane | Worktree | Note |
|---|---|---|
| **A** | `.claude/worktrees/lane-a-handoff` | On `fix/mne-268-watermark-partial-upload` as of 2026-08-18 |
| **B** | `.claude/worktrees/lane-c-billing` | Idle. The name is left over from the previous split — ignore it, the directory is what matters |
| — | `.claude/worktrees/mne-86-dogfood-automation` | Reserved for the dogfood run |

The repo root stays on `main` and takes **docs-lane commits only**.

Between tasks, **rebase in place — do not relocate**:

```
git fetch origin
git checkout -b <next-branch> origin/main
```

That keeps `node_modules`. Run `pnpm install` afterwards only if `pnpm-lock.yaml` moved. A worktree
does not share `.env` — copy it in yourself, it is gitignored and it is what `pnpm test` and
`pnpm db:migrate` read. It *does* inherit `.mneia/config.json`, which is tracked.

---

## 3. Lane A — session A — *handoff*

**Owns:** `packages/core/src/handoff/**` (new) · `packages/core/src/api/remote-store.ts` ·
`packages/cli/src/commands/handoff.ts`, `pickup.ts` · `packages/cli/src/router.ts` ·
`packages/mcp-server/src/tools/handoff*.ts` · `packages/mcp-server/src/tools/registry.ts` ·
`apps/web/src/app/api/v1/handoff/**`

> ## Lane A status — 2026-08-19
>
> **A1, A2, A4 and A6 are done and merged.** MNE-89, 90, 91, 93, 94, 95 are `Done`; five PRs —
> #135 renderer, #136 assembly and API, #139 CLI, #140 MCP tools, #141 the site correction.
> Handoff now runs end to end: `mneia handoff` / `mneia pickup`, `mneia_handoff_create` /
> `mneia_handoff_receive`, three API routes, and `listOpenHandoffs`. **No `unsupported(..., 'M2')`
> stubs remain in `remote-store.ts`.**
>
> **What is left in lane A**, in the order it is worth doing:
>
> 1. **MNE-92's other half — the live link.** Freeze is real and tested. The navigation from a frozen
>    artifact to the current state of its items is not built, and #141 removed the claim from the
>    published page rather than leave it false.
> 2. **MNE-96 — `handoff.time_to_first_action`.** Deliberately not wired. The event carries `elapsedMs`
>    and the honest reading is receipt → the receiver's *first action*, which nothing records. Emitting
>    create-to-receive under that name would put a number in the arbitration dataset that does not mean
>    what the name says. **Define "first action" before wiring it.**
> 3. **MNE-97 — format spec v0.** Standing rule 8 keeps it internal. It goes in `docs/`, never on
>    `apps/site`.
>
> **Two findings neither lane has been told to fix**, both about MNE-51's coverage scan:
>
> - Its `SURFACES` list is `packages/cli/src/commands`, so the CLI's `.receiveHandoff(` call in
>   `http-api.ts` is **outside the scan**. It passes by file placement, not by being correct.
> - `EXEMPT_CALLS` in `coverage.test.ts` now carries one file-scoped exemption, for the MCP tool:
>   the hosted API emits `handoff.received`, so emitting client-side too would double-count the
>   arbitration dataset. Read that entry before adding another.

### A1 — MNE-89, MNE-91 · The renderer and the provenance line
`handoff.rendered` is a required, non-empty column with nothing to populate it. Build to **§10.3's
worked example**, not to taste: header, **Next action**, State, Constraints, Decisions and why, Open
questions, **Superseded recently**, Artifacts.

*Next action goes first and is one concrete thing.* §10.3's standard is *"Wire the retry path in
`charges/worker.rb` to the new idempotency key. Nothing else is blocking."* A handoff whose next
action is "continue the migration" has transferred nothing.

MNE-91's provenance line is the `[human · confirmed 2026-07-14]` / `[agent · claude-code ·
unconfirmed]` prefix in that example. It is one format, used by every section — write it once.

**Done when:** a handoff renders from real project state with all eight sections and reads like the
§10.3 example.

### A2 — MNE-90 · The Superseded Recently block
> §10.3: *"The 'superseded recently' block is the highest-value section and the one nobody else
> produces. It is what stops an agent from confidently re-proposing the thing the team already
> rejected."*

Highest-leverage item in M2. It reads superseded items with their supersede reason and the decision
that replaced them.

### A3 — MNE-92, MNE-95 · Semantics
- **MNE-92 — freeze plus live link.** The artifact is frozen markdown at creation *and* a link to
  current state. Both, not one.
- **MNE-95 — open handoff, `to_actor` null.** "To: open" in the §10.3 header. The receiver is
  whoever picks it up.

### A4 — MNE-93, MNE-94, MNE-96 · The surfaces
Replace the refusals — do not leave a refusal beside a working path:
- `remote-store.ts:228-236` — three `unsupported(..., 'M2')` returns
- `packages/mcp-server/src/tools/registry.ts` — `mneia_handoff_create` / `mneia_handoff_receive`
- `packages/cli/src/router.ts` — `mneia handoff` / `mneia pickup`
- `apps/web/src/app/api/v1/handoff/**` — the route the clients call

**MNE-96** instruments `handoff.time_to_first_action`. The event name is already declared in
`telemetry/types.ts:15-17`, so this is wiring, not a new name. **Nobody adds a §17 event name** —
MNE-51's coverage test is what makes standing rule 5 real, and a new name weakens it.

### A5 — MNE-97 · Format spec v0, internal
The written form of A1. **Standing rule 8: do not publish it** until we own the reference
implementation and the early adopters. We own neither yet. It goes in `docs/`, not on `apps/site`.

### A6 — Correct the live inaccuracy
`apps/site/src/content/docs/handoff.ts` documents a feature that does not run. It stops being
inaccurate the moment A4 lands — **check it against what actually shipped in the same PR**, and
treat any gap as a finding.

---

## 4. Lane B — session B — *the M1 tail, then interop and distribution*

**Owns:** `docs/CLIENTS.md` · `packages/core/src/interop/**` (new) ·
`packages/cli/src/commands/init.ts`, `status.ts` · `apps/web/src/server/api/handlers.ts` ·
`apps/web/src/server/billing/**` · `README.md` and the package READMEs

**Do these in order.** B0 first — it is the only M1 work an agent can do, and M1 closes 2026-09-01.

### B0 — the two M1 items that are not the founder's

**B0a — MNE-79 · Client compatibility matrix.** `docs/CLIENTS.md` exists and is good, but it is
**last verified 2026-08-08 against `@mneia/mcp-server` 0.1.1** and the registry is now on **0.5.0**.
Two problems, both stated honestly in the file already:

- **Cursor is `Not checked`** in every column. MNE-79's clause is *"a published matrix documents
  verified behaviour in all three clients"* — so the ticket is not done, and the neutrality claim
  (§3 Corollary B) rests on it.
- **Codex CLI** registered but was never driven; it needs model credentials the last check lacked.

Re-verify against a `pnpm pack` tarball installed with `npm install` — **not** the workspace build.
`npm pack` leaves `workspace:^` in the dependency block and the install fails with
`EUNSUPPORTEDPROTOCOL`; `release.yml` uses `pnpm pack`. The file says so; keep it saying so.

**Done when:** the matrix documents verified behaviour in Claude Code, Cursor, and Codex against the
currently published version, and every row still says how it was checked.

**B0b — MNE-240 · Prove production error capture reaches Sentry.** The guarded probe landed
(`0a70260`, `ecbea8e`, `834ed8a`) and reports a missing DSN rather than certifying delivery that
never happened. What has never been confirmed is that a **real production event arrived**. Use the
Sentry MCP server rather than asking for a stack trace.

**Done when:** an event raised by the deployed app is visible in Sentry, and the ticket says which.

### B1 — MNE-98, MNE-99, MNE-100 · File interop (epic MNE-15)

> §12.3: *"Meet people where they already are."* §6.1: every vendor wants its own instructions file,
> and *"the 'markdown museum' problem is theirs to keep."*

This is also **the cold-start answer**. A brand new project with an empty store gives a user nothing
on day one, and a tool that provides no value until you have used it for two weeks does not survive
week one. Importing the rules they already wrote makes the first `mneia brief` useful immediately.

- **MNE-98 — import on `init`** from `AGENTS.md`, `CLAUDE.md`, and `.cursor/rules`. Imported items
  land as **constraints** with provenance pointing at the source file and `human_confirmed = true` —
  a human did write them.
  **Done when:** `init` finds and imports constraints from all three formats with correct provenance.
- **MNE-99 — fenced generated-section write-back.** Clobbering someone's hand-written `CLAUDE.md` is
  an unrecoverable trust failure — their file, their repo, their git history. The fence boundary is a
  **hard invariant with a test**, not a convention.
  **Done when:** write-back updates only inside the fence, and a test proves surrounding human
  content survives repeated writes.
- **MNE-100 — round-trip and clobber-protection tests.** The GUARD for the two above.

⚠️ **`human_confirmed` is not yours to set from a payload.** Actor kind is read from the database,
never from the caller — see §Code Review Rules in `AGENTS.md`. An import is a human-authored file, so
the flag is derived from *how the item was sourced*, resolved in the write path, not passed in.

### B2 — MNE-103, MNE-104 · Solo tier limits (epic MNE-16)

- **MNE-103 — solo tier limits enforced server-side.** §14 Solo hosted: 1 project, 30-day history,
  free.
  🔴 **The ticket's own text is stale and must not be followed literally.** It says *"self-hosted is
  unlimited by §15"* and *"self-hosted is unaffected"*. **There is no self-hosted.** §11.1 made Mneia
  hosted-only on 2026-07-28 and revoked self-hostability as a claim. Enforce on the hosted tier,
  which is the only tier, and **do not restate the revoked promise** anywhere — including in an error
  message.
  Also: **standing rule 7 — do not charge for the individual tier.** A limit is not a charge, but the
  message a user hits must not read like a paywall on solo use.
  **Done when:** limits are enforced server-side with a clear message naming what was expected, what
  was received, and what to do.
- **MNE-104 — CLI and MCP result parity test.** Originally "self-host vs hosted"; §11.1 rescoped it.
  What it means now: `mneia brief` and `mneia_rehydrate` against the same project and budget return
  the same slice. Two surfaces over one engine that quietly disagree is the failure this catches.

### B3 — MNE-106, MNE-107 · Distribution (epic MNE-17)

MNE-105 (npm publish) is done — releases are automatic since MNE-17's 2026-08-17 ruling, and
`npm view @mneia/cli version` was `0.5.0` on 2026-08-18.

- **MNE-106 — MCP registry submissions.** Depends on B0a: submitting a matrix that says "Cursor: not
  checked" is submitting the single-vendor product we are trying not to be.
- **MNE-107 — README leading with the compaction pain.** §16: lead with the compaction pain and the
  handoff artifact, **not** with "AI memory."
  ⚠️ Do not describe handoff as shipping until lane A has landed A4. Coordinate in this file.

**MNE-108 — GATE: 5 external users for a week without hand-holding** — the M2 gate. Founder's, like
MNE-88.

---

## 5. Collision rules

| Lane | May write | Must not touch |
|---|---|---|
| **A** | `packages/core/src/handoff/**`, `remote-store.ts`, `packages/cli/src/{router.ts,commands/handoff.ts,commands/pickup.ts}`, `packages/mcp-server/src/tools/{registry.ts,handoff*.ts}`, `apps/web/src/app/api/v1/handoff/**` | `packages/cli/src/commands/{init,status}.ts`, `apps/web/src/server/**`, `README.md`, `docs/CLIENTS.md` |
| **B** | `docs/CLIENTS.md`, `packages/core/src/interop/**`, `packages/cli/src/commands/{init,status}.ts`, `apps/web/src/server/api/handlers.ts`, `apps/web/src/server/billing/**`, `README.md` | `packages/core/src/handoff/**`, `remote-store.ts`, `packages/cli/src/router.ts`, `packages/mcp-server/**` |

`packages/cli/src/router.ts` is **A's**, because A adds two commands to it. B's work adds no command,
only behaviour inside `init`. If B needs a router change, say so here first.

- **Nobody adds a §17 event name.** Emit through the existing emitter or raise it in this file.
- **A migration serialises both lanes.** Announce it here before writing it, use plan mode and the
  `db-migration` skill, run `pnpm db:snapshot`, and commit `db/structure.sql` in the same commit.
  The other lane rebases on `main` after it lands, or `pnpm db:snapshot --check` fails its PR.

  Production is on **schema version 31** (`0031-session-provenance`). **Next free version is `0032`.**

- 🔴 **Your migration must be safe to apply while the OLD code is still running.** Not advice — the
  only ordering the pipeline permits. `deploy-web.yml`'s `ship` job **refuses to deploy a build whose
  expected schema version is ahead of production** (MNE-254), so the only legal order is
  **migrate → deploy**. If your migration adds anything the deployed code violates you have built a
  deadlock: migrate first and the running app errors; deploy first and the gate refuses.

  `0030` broke this and deadlocked the deploy for half an hour on 2026-08-16. **Write the additive
  half and the enforcing half as separate migrations** — backfill in `n`, constrain in `n+1`.

- **Stay in your worktree.** Do not `git checkout` another lane's branch; git will refuse, which is
  the guardrail working. Rebase on `origin/main` rather than merging between lane branches.
- **The branch belongs to the directory, not to your session.** Re-check `git branch --show-current`
  immediately before you commit, and stage explicit paths rather than `git add -A`.
- `apps/site/src/content/legal.ts` is **published legal copy**, not code. A diff that changes a
  retention period, a data-sharing statement, or the subprocessor table gets called out loudly.

## 6. Shared constraints

- **Linear cannot accept new issues** (free plan limit). Reuse the numbers above; new findings go in
  a **comment** on the closest ticket plus a pointer here. The git-lane hook rejects any commit
  message with no `MNE-nnn`.
- **Docs lane commits direct to `main`** — `*.md`, `docs/**`, `.claude/**`, `.github/**/*.md`.
  Everything else is branch → commit → push → PR, **plus `.claude/settings.json` and
  `.claude/hooks/**`**, which govern agent permissions and get reviewed like code.
- **Ask before**: production deploy, migrating production, `push --force`, `reset --hard`, history
  rewriting. Commit, push a branch, open a PR, deploy a preview — all pre-authorised.
- **A PR touching the client packages needs a changeset.** The scale is this repo's own, not semver's
  usual meanings: milestone → `major`, new command or surface → `minor`, fix or polish → `patch`.
  At `0.x` a `major` really does go to `1.0.0` and npm versions are immutable — **never write
  `major` unless a milestone is genuinely shipping.**
- **`pnpm build` typechecks zero app code.** Run `pnpm -r build`. The web build needs a Clerk key
  locally — use a dummy so you can tell your bug from a missing env.
- **`pnpm test` needs a direct `DATABASE_URL`, not the `-pooler` one.** Without it the integration
  suites skip silently, which looks exactly like a pass.
- **Do not restate revoked promises**: self-hostability, offline operation, "content never leaves
  your machine." Hosted-only since 2026-07-28; privacy is enforced by controls, not locality.

## 7. Open findings neither lane has been told to fix

**The server has no defence against a watermark regression.** `turnsSince` returns `resolved: false`
when the stored watermark is absent from the uploaded turns, and `apps/web/src/server/api/propose.ts`
never reads `resolved`. Today the CLI is the only uploader and it avoids the case by asking for the
watermark first and uploading from it — but `http-api.ts`'s `marked < 0` branch still uploads from
turn 0, and any other client can walk the watermark backwards and make us re-pay for inference.

**This is not a straightforward bug fix.** `propose.test.ts:142` pins the current behaviour
deliberately — *"re-reads the whole window when the watermark is not in this transcript, so no turn
is skipped"* — trading cost for losslessness. Changing it is a **ruling**, not a patch: refuse the
upload, or keep re-reading and refuse only to move the watermark backwards. **Founder's call**, and
it needs one before either lane touches `propose.ts`.

---

**Added 2026-08-19 by lane B, from B0.** Three findings, none of them lane A's problem, none fixed.

### `apps/site` is throwing an unhandled rejection in production ~275 times a day

`CompileError: WebAssembly.compile(): Wasm code generation disallowed by embedder` — **4,723
occurrences since 2026-08-02, still firing.** Sentry [JAVASCRIPT-NEXTJS-3], event
`f8a140332cb046e08bec2d556311d41d`, `environment: production`, `runtime.name: cloudflare`,
`release: 3214441`.

**Confirmed deployed, not a `wrangler dev` artifact.** MNE-240's description attributes an older
instance of this issue to `wrangler dev`, and `server_name: localhost` looks the same either way — so
Sentry alone could not settle it. Cloudflare's own Workers observability for the deployed worker
`mneia` shows the identical error with identical frames, and the `c (worker.js:NNNNN)` offset tracks
the deployed bundle across deploys (`61120` → `61352` → `61375`).

Cloudflare forbids runtime `WebAssembly.compile()`; wasm must be a declared module import, and
`apps/site/wrangler.jsonc` declares no wasm binding. Nothing in `apps/site/src` references
`WebAssembly`, so it is a bundled dependency. **Hypothesis, unproven:** the event carries Node SDK
tags (`auto.node.onunhandledrejection`, `os: Linux`, `arch: x64`) from a `cloudflare` runtime, and
`apps/site` depends on `@sentry/nextjs` — the Node build — where the Worker wants `@sentry/cloudflare`.

`Users Impacted: 0`, so probably not user-visible. But it is loud enough to bury a real error.

### We cannot debug production errors, because no source maps are uploaded

Every frame in that event is a minified bundle offset. Not one names a file in `apps/site/src`.
This is why MNE-240's clause says *"a stack trace that names first-party frames"* — that half is
**not met**, and it is the highest-value item left on the ticket. Capture works; debugging does not.

### `26765d9` fixes a production 500 and is not merged

`fix/mne-86-rehydrate-500` carries the fix for `POST /api/v1/rehydrate` returning HTTP 500 with an
empty body on `apps/web` — `gpt-tokenizer` resolving to `MODULE_NOT_FOUND` under `next build
--output standalone`. Pushed, **not on `main`, not deployed.** It is MNE-86's, so it is the founder's
dogfood branch rather than either lane's, but it should not sit there unnoticed.

**Not the same bug as the wasm one above.** Different app, different runtime, different failure. Do
not close one with the other.

### Lane B status

- **MNE-79** — `docs/CLIENTS.md` re-verified against published 0.5.0 in `a804180`. **Cursor moved
  from "Not checked" to registered with all four tools discovered.** Clause still unmet: no tool call
  driven in Cursor or Codex, both blocked on account limits, Codex's clearing **2026-08-23**.
  Separate finding in that file: **our documented `npx -y @mneia/mcp-server` config exceeds Claude
  Code's 30s MCP startup timeout on a cold cache**, half of it because the server makes a network
  round trip before serving its first frame.
- **MNE-240** — production capture is **proved working**. Ticket stays In Progress: source maps,
  `apps/web`, and the guarded probe route are all unmet, and each needs a production deploy, which
  `CLAUDE.md` says to ask about first.
