# In-progress triage and the two-session split

**Written 2026-08-05.** 30 tickets sat in `In Progress`, which `ROADMAP.md` §0.2 forbids. This file
triages all 30 and divides the remainder between two Claude Code sessions running in parallel
worktrees.

**No new tickets. Nothing new from the backlog until this list is empty.**

---

## The rule that makes parallelism safe

The split is by **directory tree**, not by feature. One session owns `packages/**`, the other owns
`apps/**`. There is no file either session needs that the other also needs.

| | Session A — engine | Session B — surface |
|---|---|---|
| Owns | `packages/core/**`, `packages/cli/**`, `packages/mcp-server/**`, `scripts/**`, `db/**` | `apps/web/**`, `apps/site/**`, `.github/workflows/deploy-web.yml` |
| Branch prefix | the ticket's own `<type>/mne-<n>-<slug>` | same |
| Existing worktree | `.claude/worktrees/lane2-mcp` (`feat/mne-74-mcp-local-store`) | `.claude/worktrees/mne-181-device-flow` |

**If you need a change in the other session's tree, do not make it.** Write it down and hand it over.
`apps/web` imports `@mneia/core` — Session B may *read* `packages/core` and must never *edit* it.

### Shared files — the only real collision risk

| File | Rule |
|---|---|
| `pnpm-lock.yaml` | Never hand-merge a conflict. `git checkout --theirs`, then `pnpm install` and commit the regenerated file |
| root `package.json` | Neither session edits it without saying so first |
| `docs/DOGFOOD-BUILD.md` | Session A owns lanes 1–2 rows; Session B owns nothing here |
| `AGENTS.md`, `CLAUDE.md`, `CODEX.md` | **Session A only.** Session B files corrections instead of making them |
| `.github/workflows/ci.yml`, `database.yml` | Session A only |
| `apps/site/src/content/legal.ts` | Session B only — and it is published copy, see `AGENTS.md` |
| Linear | No conflict. Each session touches only its own tickets, listed below |

---

## Triage of the 30

### Close after verifying — shipped code, `Done when` looks satisfied (17)

Do **not** rubber-stamp these. Open the ticket, read its own *Done when* clause, confirm against the
evidence, then move to `Done` with a comment citing the file. If a clause is not met, it drops into
the open list instead.

**Session A verifies and closes:**

| Ticket | Evidence to check against |
|---|---|
| MNE-206 Shared type contracts | `packages/core/src/domain/types.ts` |
| MNE-48 Event schema + typed emitter | `telemetry/types.ts` (all §17 events), `telemetry/emitter.ts` |
| MNE-49 Local JSONL sink | `telemetry/sinks/jsonl.ts` + `jsonl.test.ts` |
| MNE-50 Telemetry privacy | `telemetry/redact.ts`, `privacy.test.ts`, `MNEIA_TELEMETRY` opt-out at `emitter.ts:162` |
| MNE-63 GUARD never auto-supersede | `policy/supersede.ts` + `supersede.test.ts` |
| MNE-67 Scoring function v1 | `rehydrate/score.ts` + test |
| MNE-68 Per-kind quota packer | `rehydrate/pack.ts` + test |
| MNE-69 GUARD load-bearing constraints | `rehydrate/guard.test.ts` |
| MNE-70 Token accounting + truncation | `rehydrate/tokens.ts` + test |
| MNE-71 Slice render format | `rehydrate/render.ts` + test |
| MNE-74 MCP scaffold + stdio | Server starts and advertises four tools. Clause is *"reports its tools"* — the store binding is MNE-75/76/77/78, not this |

**Session B verifies and closes:**

| Ticket | Evidence to check against |
|---|---|
| MNE-217 Deploy apps/web | `.github/workflows/deploy-web.yml`. **Clause needs a reachable URL** — load it before closing |
| MNE-218 Waitlist campaign sender | `scripts/waitlist-notify.mjs`, `waitlist-campaigns.mjs`, `waitlist_broadcast_send` uniqueness |
| MNE-220 Wordmark gap | `MneiaMark.tsx` now `viewBox="0 0 22 24"`. Look at the rendered nav, not the source |
| MNE-223 FAQ / contact / help / docs | `apps/site/src/app/{faq,contact,help,docs}` all exist. Clause also names SEO/AEO/GEO indexing — check `sitemap.ts`, `llms.txt`, `robots.txt` |
| MNE-233 Waitlist admission | PRs #51 and #55 merged. #58 was **closed unmerged** — confirm the env-var path is actually covered |
| MNE-234 `/welcome` | PR #51 merged, `apps/web/src/app/welcome` exists |

### Descope — ruled cut, close as cancelled (1)

| MNE-81 CLI `mneia init` | `docs/DOGFOOD-BUILD.md` cuts it entirely: it writes `.mneia/config.json` into the working tree and rewrites a fence in the host repo's `AGENTS.md`, which is gitignored here but *not* in Ascend's repo. Bootstrap writes `~/.mneia/local.json` instead. **Session A** closes with that rationale |

### Genuinely open (12)

---

## Session A — engine

Everything here is blocked on one thing, which just unblocked: PR #59 merged, so
`PostgresStoreAdapter` is exported from `@mneia/core`.

**Do this first.** `.claude/worktrees/lane2-mcp` holds finished MCP-binding work that was waiting on
#59. Rebase it on `main` and land it before starting anything else — every ticket below depends on it.

| Ticket | What is actually left | Files |
|---|---|---|
| MNE-75 `mneia_rehydrate` | Returns `store_unavailable`. Needs the real store behind it, then the p95 < 300ms measurement §12.1 requires | `mcp-server/src/tools/rehydrate.ts`, `bin.ts` |
| MNE-77 `mneia_checkpoint` | Same binding, plus `sliceId` / `referencedItemIds` so `item_referenced` ships day 1 | `mcp-server/src/tools/checkpoint.ts` |
| MNE-76 `mneia_assert` | Same binding. Verify `human_confirmed` is still derived from `actor.kind` and never from the payload | `mcp-server/src/tools/assert.ts` |
| MNE-78 `mneia_search` | Same binding. `store_unavailable` at `search.ts:237` | `mcp-server/src/tools/search.ts` |
| MNE-82 CLI `mneia brief` | Stub at `brief.ts:162` | `packages/cli/src/commands/brief.ts` |
| MNE-84 CLI `mneia log` | Stub at `log.ts:403` | `packages/cli/src/commands/log.ts` |
| MNE-85 CLI `mneia status` | Stub at `status.ts` | `packages/cli/src/commands/status.ts` |

Plus the store surface still owed by `DOGFOOD-BUILD.md` lane 1 — `createProject`,
`confirmContextItem`, `decay_after` in the INSERT list, and the bootstrap script that creates the
**agent actor**. Without that actor, standing rule 1 is defeated by construction.

## Session B — surface

| Ticket | What is actually left | Files |
|---|---|---|
| MNE-181 Web account plane | PR #45 is open and is **1 of 5**. Largest single item on either side | `apps/web/**`, worktree already exists |
| MNE-222 Consent-gated ad tracking | PR #37 open. Touches `legal.ts` — published copy, and the subprocessor table must move with it | `apps/site/**` |
| MNE-205 Honeybadger alongside Sentry | Not started. No `honeybadger` reference anywhere in `apps/site` | `apps/site/src/instrumentation*.ts`, `global-error.tsx` |
| MNE-198 `@sentry/cloudflare` on the Worker | Not started. `apps/site/package.json` still has `@sentry/nextjs` only | `apps/site/package.json`, sentry configs |
| MNE-224 Codex footing | `CODEX.md` and `docs/BUSINESS.md` exist; the **automated PR review** third of the ticket does not — no Codex reference in `.github/`. Either land it or descope that third explicitly | `.github/**` — **coordinate with Session A before touching `.github/`** |

MNE-224 is the one genuine boundary crossing. It is assigned to B because the ticket is B-shaped, but
`.github/` is A's tree. **B must not edit `.github/` without A confirming it is idle there.**

---

## Order of work

Both sessions: **verify-and-close first, build second.** Closing is cheap, it is what the founder
asked for, and it makes the remaining list honest before either session spends a token on new code.
