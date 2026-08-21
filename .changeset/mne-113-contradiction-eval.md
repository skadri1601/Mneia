---
'@mneia/core': patch
---

Measure the contradiction classifier against a labelled eval set, and fix the three misses it found.

`packages/core/src/extract/eval/` holds 28 hand-written cases drawn from this repo's own decision
history — genuine reversals (the §11.1 locality promise, MNE-17's move to automatic publishing, the
2026-08-19 migration ruling) alongside the near misses that must not fire: the same rule stated from
the other end, two tiers that share every word and conflict in none, two sessions whose costs differ
because they are different sessions. Each case records why it is labelled the way it is. The harness
reports precision and recall for the contradiction class separately, because the two failure modes
cost different things: a false positive interrupts a human for nothing and teaches them to dismiss
without reading, a false negative is the §2.1 pain the product exists to prevent.

The recorded numbers live in `eval/baseline.json` and a test fails when they move, so a change to the
classifier has to update them in the same diff.

Three defects the set exposed, each fixed and each moving a named case:

- A contradiction arriving with its own reasoning attached was recorded as new rather than flagged.
  `judge` bailed out to `novel` whenever the body differed, before it ever looked at stance — and a
  real reversal almost always carries a body explaining itself. Signals are now read first.
- A value arriving where the recorded item carried none was reported as a value conflict. Refining
  "bound the concurrency" to "bound the concurrency to 8" is not a disagreement; there is no earlier
  number for 8 to disagree with. `value_conflict` now needs a value on both sides.
- The negation marker list carried `refuse` and `refused` but not `refuses`, and fifteen more gaps
  like it, so a prohibition described in the third person read as an assertion of its opposite. The
  missing inflections are in.

Contradiction precision moved from 0.60 to 0.71 and recall from 0.69 to 0.77 across those three
fixes. Seven cases still fail and are recorded as failing: the classifier is lexical, and an antonym
pair (`manually` against `automatically`, `enforced` against `bypassed`) carries no shared token to
key on.
