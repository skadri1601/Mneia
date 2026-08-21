---
'@mneia/core': patch
---

Score the §10.2 rehydration ranking against a fixed corpus and a set of golden tasks, so a weight
change can be evaluated instead of guessed at.

`packages/core/src/rehydrate/eval/` holds forty `context_item` rows shaped like one quarter of a
project's memory — six active `load_bearing` constraints, two supersession chains, a near-duplicate
fact pair, a stale fact past its `decay_after`, a disputed row, and one row whose `valid_to` has
passed — plus five golden tasks carrying graded relevance and an intended head of the ranking. Every
timestamp is a fixed offset from a fixed now, every id is a hash of its slug, and every embedding is
a hand-authored topic vector, so the harness needs no database, no network, and no model key.

`runEval` takes a `ScoringWeights` configuration, runs the real `scoreItems` and `packSlice` path,
and reports precision, recall, must-have recall, nDCG@10 and an intended-top match per task and in
aggregate. `compareEvals` diffs two runs into per-metric deltas and the tasks that moved.
Load-bearing constraint inclusion is checked separately and throws rather than averaging into a
metric — standing rule 2 admits no score that offsets a dropped constraint.

The recorded baseline for `DEFAULT_SCORING_WEIGHTS` is checked in, so a ranking change has to move
the numbers in the diff where a reviewer sees them.
