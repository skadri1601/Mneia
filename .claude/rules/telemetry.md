---
paths:
  - "packages/core/src/telemetry/**"
  - "**/events/**"
  - "**/*telemetry*"
---

# Telemetry rules — §17, non-negotiable

`vision.md` §17: **"This is the moat. It cannot be retrofitted, because a year of unlogged usage is
a year of lost training data."**

This is not analytics. It is a **training dataset**. That distinction drives every rule below.

## The nine events

`rehydration.slice_shown` · `rehydration.item_referenced` · `rehydration.item_ignored` ·
`checkpoint.item_extracted` · `checkpoint.item_confirmed` / `edited` / `rejected` ·
`conflict.detected` / `resolved` · `item.superseded` · `handoff.created` / `received` ·
`handoff.time_to_first_action`

Every one carries actor, project, timestamp, and item ids.

## Typed, not stringly

Use the typed emitter. Never a string-keyed `track()`. A misspelled event name in an analytics
pipeline costs a dashboard; here it costs unrecoverable training examples.

## The coverage test is the enforcement

MNE-51 enumerates every write path and fails CI if one emits nothing. **Do not weaken or skip it.**
A convention will not survive twelve months of solo development; a failing test will.

Adding a write path means adding its event in the same PR. There is no follow-up ticket for this.

## Privacy is a hard boundary — restated for hosted-only

MNE-50 originally read *"no code and no conversation content leaves the machine by default."*
**Hosted-only (§11.1) makes that literally false** — item bodies live in our Postgres, because a
shared memory layer with no shared bodies is not a product. Do not quote the old wording.

Three boundaries replace it, and all three are enforceable:

1. **We store extracted items, not raw material.** A checkpoint reads the transcript, extracts typed
   items, and discards the transcript. Full conversation logs and file contents are never persisted.
   The user's own words survive only inside an item they would recognise as theirs.
2. **§17 events carry ids, types, and outcomes — never bodies.** The ranking signal does not need the
   prose, and keeping it out means the training corpus is structurally incapable of leaking one
   customer's decisions into another's ranking.
3. **Scope is enforced on read** (MNE-169), not on write. A `private` item is invisible to a
   workspace query even though it sits in the same table.

The invariant test survives the rewrite unchanged: **no item `body` appears in a §17 event payload.**
Keep it passing — it is now the load-bearing half of the promise rather than a nice-to-have.

## Do not route §17 events into a product-analytics tool

PostHog, Amplitude, and similar are the wrong home for this data. It has to be joinable to item ids,
exportable, and queryable for the MNE-117 tuning pass. It lives in our own store.

Product analytics for funnel and retention (MNE-124, MNE-143) is a separate concern and may use a
separate tool. Do not merge the two pipelines.

## North-star

Percentage of rehydrated items that get referenced, **per team**, trended over time. A global average
hides the compounding effect we are trying to detect. §17: *"If it stays flat, we are a nicer
markdown file."*
