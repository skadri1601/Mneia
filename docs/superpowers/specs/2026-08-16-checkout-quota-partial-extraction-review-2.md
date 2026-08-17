# Review round 2 — checkout, quota, partial extraction

Verifying the revision against round 1's five blocking findings, and against the code rather than
against the spec's description of it.

**Four of the five are genuinely fixed. One is not, and the revision introduces three new problems.**
Not ready for an implementation plan yet — but the remaining work is small and specific.

---

## The five blocking findings

### 1 — Checkout UI in Lane B's files · **FIXED**
`design.md:7` now creates `apps/web/src/app/billing/**` and states plainly that the lane does not
edit `app/team`, `app/join`, or `server/current-account.ts`. `:13` describes the new `/billing` page,
`:21` picks up the portal link, and `:57` picks up C3. The old Team-page line is gone entirely.
Reading Lane B's account context is a read, and `WORKSTREAMS.md:242` lists writes.

**One gap:** nothing says how a user *reaches* `/billing`. A nav entry lives in `app/layout.tsx` or
the team page — which is exactly where the collision reappears. Decide it now rather than at the end.

### 2 — CLI propagation out of lane · **FIXED**
`design.md:9` drops the CLI edit and records the dependency instead. The shared-core edit it keeps
(`telemetry/types.ts`, `api/wire.ts:561-562`) is not on the must-not-touch list and is announced,
which is what round 1 asked for.

**But say the consequence plainly.** Coverage only reaches §17 when the client echoes it on the
write request — `handlers.ts:299-310` is the only emit site. No Lane A task exists for that echo. So
**MNE-268's actual symptom, "a partial extraction is invisible to §17", is still true in production
after this lane merges.** That is a sequencing fact, not a compatibility note, and the spec currently
frames it as the latter.

### 3 — Fail-closed on a null allowance · **FIXED**
`design.md:35` makes `checkpoint_allowance IS NULL` temporarily unmetered — fail-open. `:41` declares
a no-migration lane, so `WORKSTREAMS.md:246-248` is not triggered. Verified the column is still
nullable with no default (`db/structure.sql:712`, check at `:721` permits null).

**Unstated cost:** every row is null today, so the enforcement half of MNE-178 ships as code no
workspace can reach. No done-when covers it. That is a defensible choice, but it should be a stated
one.

### 4 — Wrong meter and the margin leak · **PARTIALLY FIXED**
Switching to `checkpoint_usage` (`:29`) genuinely closes three of the four holes:

- **Abandoned proposals** — closed. `recordUsage` fires at `propose.ts:179`, inside the propose
  request, before any write.
- **Zero-candidate checkpoints** — closed. Attempts are pushed at `propose.ts:160` on a successful
  model call regardless of how many candidates parse.
- **Swallowed emits** — closed as a metering concern. `recordUsage` is awaited and throws
  (`checkpoint-source-store.ts:94-112`); it does not go through `emitQuietly`.

**But `:29` and `:31` assert something the code does not do.** *"It records successful, failed, and
fallback model attempts"* and *"a failed proposal still consumes one"* are **false as built**.
`select.ts` builds an `attempts` array and then throws it away on every failure path
(`extraction/select.ts:126`, `:135`, `:155` — each `throw` discards the local array).
`propose.ts:150-158` catches and pushes nothing, so `propose.ts:178`'s `attempts.length > 0` is false
and **no row is written**. A proposal where primary and fallback both fail meters **zero, after two
real provider calls.**

That is the leak, still open, in a narrower form. Closing it means editing
`apps/web/src/server/extraction/select.ts`, which is on **no lane's may-write list**
(`WORKSTREAMS.md:238-242`) — declare it.

**Also worth naming:** a multi-chunk proposal loops `deps.run` per chunk (`propose.ts:145-176`) and
calls `recordUsage` **once** (`:179`). So N inference calls on a large session meter as one unit.
That is consistent with "one checkpoint, one unit", but it is precisely the large-session case the
margin argument exists for, and the spec should say it is deliberate.

### 5 — `incompleteReason` carrying transcript content · **FIXED**
`design.md:47` sanitises to `provider_failed | invalid_output | null` and keeps raw text in the HTTP
response only. Confirmed the original defect was real: `propose.ts:168` interpolates `error.message`,
built at `extract/schema.ts:92` from `preview(text)` — up to 200 chars of raw model output
(`schema.ts:65-68`).

Worth knowing why this mattered: `privacy.test.ts:12,121-139` is a **fixed key-name sentinel list**,
and `incompleteReason` is not on it. A free-text field would have passed the privacy test while
carrying content.

---

## Three problems the revision introduces

### A — The dunning posture contradicts the code it runs on
`design.md:21` says `unpaid` and `canceled` remove entitlement. But `seats.ts:61` maps Stripe
`unpaid` → `past_due`, and `:62` maps `incomplete` → `past_due` — and `design.md:37` grants
`past_due` **full entitlement**.

So a subscription that **never paid**, or one Stripe has given up dunning, keeps Team entitlement
indefinitely. That is a new margin leak, created by this revision.

### B — `past_due` with seats is unrepresentable
`stateAfterSubscription` (`seats.ts:93-97`) sets `plan: 'solo'` and `seatsPurchased: null` for
anything not `active`/`trialing`. So "a Team workspace in `past_due` with enough seats"
(`design.md:37`) **cannot exist in the data**. `seats.ts` is Lane C's to change — but the spec never
says it will.

### C — Narrowing the cancellation guard reopens the bug it was built for
`design.md:19` distinguishes a new `customer.subscription.created` from a delayed
`customer.subscription.updated`. But the guard at `webhook.ts:113-118` keys on
`subscription.customerId === current.billingCustomerRef`, and **no subscription id is persisted
anywhere** — `BillingState` is `{plan, billingStatus, seatsPurchased, billingCustomerRef}`
(`seats.ts:50-55`) and `workspace` has no subscription column (`db/structure.sql:704-718`).

The guard's own comment says only a *newer subscription id* may move a workspace off `canceled`,
which this lane cannot check. **Event type is not a proxy for freshness** — Stripe can deliver a
`.created` late too. Making this safe needs a stored subscription ref, which is the migration the
lane rules out. Either keep the existing guard as-is, or declare the migration.

---

## Clean

No new migration. No new §17 event name — `TELEMETRY_EVENT_NAMES` (`telemetry/types.ts:4-18`)
untouched, so MNE-51's coverage test is safe. The quota query is declared RLS-scoped and
`checkpoint_usage` is `FORCE ROW LEVEL SECURITY` with a workspace policy (`db/structure.sql:211-213`).
Standing rule 7 holds — `design.md:38` keeps solo free and closes checkout to one-person workspaces.
Round 1's finding 10 is resolved by reusing `forbidden` (`api/http.ts:3-12`) instead of editing
shared `http.ts`. Good call.

## Done-when

Much better, and it now names the journey: `design.md:63` requires a two-member workspace to go from
no subscription through Checkout to active Team, open the portal, cancel, and resubscribe — with unit,
preview, and live-test-mode evidence separated. That answers round 1's closing section.

Two holes: **MNE-178 and MNE-268 have no done-when of their own**, and both are the tickets whose
outcomes are contingent — quota enforces on nobody while every allowance is null, and coverage
reaches §17 only if Lane A echoes it back.

---

## What to change before the implementation plan

1. Correct `:29`/`:31` — `checkpoint_usage` does **not** record failed attempts today. Either declare
   the `select.ts` / `propose.ts` change that makes it true, or drop the claim and accept that a
   double-failure proposal meters zero.
2. Resolve A and B together: decide what `past_due` means, and say that `seats.ts` changes to
   represent it.
3. Resolve C: keep the existing cancellation guard, or declare the migration that stores a
   subscription ref.
4. Say how a user reaches `/billing`.
5. Give MNE-178 and MNE-268 their own done-when, including the honest one — that each enforces on
   nobody until a follow-up lands.
