# Review — checkout, quota, partial extraction design

Reviewing `2026-08-16-checkout-quota-partial-extraction-design.md` (`72c1c1e`) against
`docs/WORKSTREAMS.md` §5–§7, `docs/BUSINESS.md`, and the code as it stands in this worktree.

**Do not start implementing yet.** Five findings below are blocking: two would collide with work
already in flight in the other two lanes, one would take production down on deploy, one leaves the
margin leak the ticket exists to close, and one breaks a privacy invariant.

The parts that are right are named at the end — the shape of the design is sound, and the Stripe
metadata decision in particular is the correct one.

---

## Blocking

### 1. The checkout UI is specced into Lane B's files

> *"The Team page gains a billing section."* — design, line 9

`WORKSTREAMS.md:242` puts `app/team` on Lane C's **must not touch** list, and `:241` assigns
`app/{team,join,welcome,device,admin}/**` to Lane B. Lane C owns **`apps/web/src/app/billing/**` —
new**, which the design never mentions.

`apps/web/src/app/team/page.tsx` and `team/actions.ts` are live Lane B files, and Lane B is editing
that area right now (PR #117). A lead/member check would also pull in `server/current-account.ts`,
also Lane B's.

Move it to `/billing` before writing code. That page is also an assigned deliverable that the design
currently drops — see finding 11.

### 2. The CLI propagation step is Lane A's file, and it is mid-change

> *"The CLI preserves them through human review and includes them in the checkpoint write
> request."* — design, line 33

`packages/cli` is on Lane C's must-not-touch list (`WORKSTREAMS.md:242`). The fields would land in
`packages/cli/src/commands/checkpoint.ts:494-508`, next to `pendingTurns` / `incompleteReason` /
`droppedBeforeUpload` — which Lane A changed in PR #116 and is changing again.

Nothing in C1–C3 needs the CLI. Drop the step, or say what it is for and let Lane A carry it.

### 3. Failing closed on a null allowance bricks every workspace on deploy

> *"a workspace whose `checkpoint_allowance` is null is refused"* — design, line 23

`workspace.checkpoint_allowance` is nullable with **no default** (`db/structure.sql:712`,
`0002-core-entities.ts:27`) and is written `null` everywhere today. So the moment this deploys,
**every workspace that exists — solo, team and enterprise alike — stops being able to checkpoint.**

It compounds: line 9 refuses checkout below two accepted members, and line 26 gives solo no checkout
path at all. A solo workspace is therefore hard-blocked *and* structurally unable to pay to unblock
itself. `BUSINESS.md` calls that tier "the adoption wedge and the first dataset"; this turns it off.

Fixing it needs a default or a backfill, which is **a migration the design does not declare**.
`WORKSTREAMS.md:246-248`: a migration serialises all three lanes and has to be announced before it
is written.

Fail **open** on null and treat absence as "not yet metered", or ship the backfill first and say so.

### 4. The chosen meter does not count the thing being gated, and it leaves the leak open

> *"count distinct `checkpointId` in `checkpoint.item_extracted` payloads"* — design, line 19

Three concrete failures, in order of cost:

- **Extraction happens at propose; the event fires at write.** Inference runs at `propose.ts:150`.
  `checkpoint.item_extracted` is emitted from `handlers.ts:300`, in a **separate later request the
  client may never send**. Calling propose in a loop and never writing is unlimited inference at
  zero recorded usage — which is precisely the margin leak `WORKSTREAMS.md:200` asks this lane to
  close.
- **A checkpoint that extracts nothing emits nothing.** The event fires per written item
  (`handlers.ts:299`), so a full-cost inference call that yields zero candidates meters as zero.
- **`emitQuietly` swallows sink failures** (`handlers.ts:44-48`). A degraded sink silently zeroes
  every workspace's usage — and `WORKSTREAMS.md:219-220` asked this lane to look at that function
  specifically.

`checkpoint_usage` already exists, is RLS-scoped, is written **at propose time for every attempt
including failures** (`checkpoint-source-store.ts:88-111`, `propose.ts:179`), and already carries
`checkpoint_usage_metering_idx ON (workspace_id, created_at)` (`db/structure.sql:210`).

The design rejects it in one clause on doctrine. `BUSINESS.md:67` — *"do not build a second"* —
forbids building a **new** counter; it does not require ignoring the one the cost path already
writes. Using `checkpoint_usage` is not a second system, it is the ledger that already exists.

If §17 must remain the source of truth, the design has to say how it handles zero-item checkpoints,
abandoned proposals, and swallowed emits. Right now it addresses none of the three.

### 5. `incompleteReason` would carry transcript content into a §17 event

> *"The values contain counts and a control-flow reason, never transcript or item content."*
> — design, line 35

Not true as built. `propose.ts:168` embeds `ExtractionError.message`, and `extract/schema.ts:92`
builds that message from `preview(text)` — **up to 200 characters of raw model output**
(`schema.ts:65-68`), derived from the transcript. `propose.ts:156` likewise embeds an arbitrary
provider error message.

`.claude/rules/telemetry.md` states the invariant as "no item body appears in a §17 event payload",
and `privacy.test.ts` checks it with a sentinel — so **a free-text field passes that test while
carrying content**. That is worse than an uncovered gap.

Sanitise to a code plus counts, or drop the field.

---

## High

### 6. Two of the three coverage fields do not exist, and the third is always zero

Line 33 names `droppedTurns`, `splitTurns`, `incompleteReason`. In the code:

- the proposal wire carries `pendingTurns`, `consumedTurns`, `incompleteReason`
  (`api/wire.ts:561-562`, `propose.ts:243-247`)
- `splitTurns` is returned by `chunkTurns` and **discarded** — `propose.ts:136` destructures only
  `{ chunks }`
- `droppedTurns` comes from `reduceTrajectory`, which `propose.ts:109-117` calls with
  `maxChars: Number.MAX_SAFE_INTEGER` — so server-side it is **structurally zero**

The only real drop was client-side, and Lane A removed it in PR #116. Design against
`pendingTurns` / `consumedTurns` and start capturing `splitTurns`, which is the signal you actually
want and is currently thrown away one character from where it is produced.

### 7. Customer reuse is unaddressed, and it turns the cancellation guard into a lockout

`webhook.ts:113-126` refuses any non-cancel event when `billingStatus === 'canceled'` **and**
`subscription.customerId === current.billingCustomerRef`. The design never says whether checkout
reuses the stored `billing_customer_ref`.

- Reuse it (the natural Stripe pattern) → a cancelled team that pays again is refused forever.
- Do not reuse it → you orphan the Stripe customer and duplicate billing records.

Pick one explicitly.

### 8. No idempotency key, and nothing stops a second subscription

`StripeClient.post` (`stripe.ts:106-136`) sends no `Idempotency-Key`, and the design adds none. It
also states no precondition that the workspace is not already `active` or `trialing`. Two completed
checkouts produce two Stripe subscriptions, and `applyBillingState` (`billing-store.ts:126-141`)
simply overwrites `billing_customer_ref` — so the first keeps billing, invisibly.

### 9. `past_due` has no grace period

`seats.ts:93-95` drops a non-paying status to `plan: 'solo'` with `seatsPurchased: null`, and line 25
requires `active` or `trialing` to pass the gate. With finding 3, one declined card instantly stops a
paying team from checkpointing. Define a grace window and the dunning behaviour.

---

## Medium

### 10. The "typed API error" has no type
`API_ERROR_CODES` (`api/http.ts:3-12`) has no quota code. Either the denial degrades to `forbidden` /
`rate_limited`, or Lane C edits `packages/core/src/api/http.ts` — shared with Lane A and not in
Lane C's owned paths. Say which.

### 11. Two assigned items are dropped
- **C3 is absent entirely** — correcting the stale `AGENTS.md:77-88` (`WORKSTREAMS.md:226-228`).
- **The `/billing` page and portal link** (`WORKSTREAMS.md:195`) are never mentioned. Without a
  portal a customer can start paying and then cannot change or cancel a card.

### 12. Checkout is unreachable until Lane B lands
The ≥2-accepted-members gate depends on invitations working, which `WORKSTREAMS.md:152-160` says
they do not for anyone who signed up solo first. Lane B's PR #117 is that fix. Declare the
dependency.

### 13. "Checkpoint proposal is the inference boundary" is not accurate
The write path calls `embedItems` (`handlers.ts:262-266`) and rehydrate calls `embedOne`
(`handlers.ts:197`). Both are real embedding spend and neither is gated.

### 14. Calendar month is not the billing period
Line 19 says "current calendar month", line 29 says "the current monthly period". A subscription
starting on the 20th would reset its allowance on the 1st. Pick one.

### 15. The price is a founder call
The design is right not to hardcode a price, and reusing `STRIPE_PRICE_ID` is correct. But
`SEAT_PRICE_USD_CENTS = 2400` sits in `stripe.ts:11` waiting to be rendered, and
`WORKSTREAMS.md:283-285` records that $24 is **provisional** — MNE-180 measured the token spread and
deliberately refused to convert it to money. State that the page displays no price until that ruling
lands.

---

## Checked and clean

- **No §17 event name is added, renamed or removed.** `TELEMETRY_EVENT_NAMES`
  (`telemetry/types.ts:4-18`) is untouched and MNE-51's coverage test is safe. Note that extending
  `ItemExtractedEvent` (`types.ts:52-59`) still means editing `packages/core/src/telemetry/**`,
  outside Lane C's owned paths — announce it even though it is not a name change.
- **Standing rule 7 is not violated literally** — nothing charges solo. Finding 3 makes the free
  tier unusable, which is commercially worse than charging it, but it is a bug rather than a rule
  break.
- **No premature Team-tier feature claims.** Line 5 rules them out explicitly. Good.
- **The metering index claim is accurate** — `telemetry_event_metering_idx` exists
  (`db/structure.sql:649`), the table is `FORCE ROW LEVEL SECURITY` (`:652`), and a default
  partition exists so inserts cannot fail (`0019-telemetry-event.ts:30`).
- **Webhook signature verification, replay tolerance and metadata-only workspace resolution are all
  preserved.** Putting `workspace_id` in subscription metadata (line 11) is the right call and keeps
  `webhook.ts:79-91`'s no-unscoped-lookup guarantee intact.
- **`legal.ts` needs no change** — Stripe is already a subprocessor (`legal.ts:53`) and billing data
  including *"checkpoint consumption"* is already disclosed (`legal.ts:250`). Worth stating in the
  Verification section that this was checked, which is what `WORKSTREAMS.md:253-254` asks for.

## On the done-when criteria

Line 43 lists unit tests of encoding, mapping and propagation. None of them demonstrates the journey
MNE-141 is actually about — **a team going from no subscription to a paid one, and back**. Given
findings 1 and 12, that journey cannot currently be completed on this branch at all.

`WORKSTREAMS.md:229-231`: a ticket is done when its own *Done when* clause is satisfied, not when the
code is written. Write a criterion that names the journey.
