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

## Privacy is a hard boundary

**No code and no conversation content leaves the machine by default** (MNE-50). Ids, types, and
outcomes carry the ranking signal; item bodies do not.

Events land in a local JSONL sink first, always. Remote transmission is opt-in and purely additive —
that ordering is what lets a self-hosted user (§15) accumulate their own arbitration data and get the
benefit of ranking that learns from it, without sending us anything.

A test asserts no item `body` appears in the remote payload. Keep it passing.

## Do not route §17 events into a product-analytics tool

PostHog, Amplitude, and similar are the wrong home for this data. It has to be joinable to item ids,
exportable, and queryable for the MNE-117 tuning pass. It lives in our own store.

Product analytics for funnel and retention (MNE-124, MNE-143) is a separate concern and may use a
separate tool. Do not merge the two pipelines.

## North-star

Percentage of rehydrated items that get referenced, **per team**, trended over time. A global average
hides the compounding effect we are trying to detect. §17: *"If it stays flat, we are a nicer
markdown file."*
