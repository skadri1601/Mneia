---
'@mneia/core': minor
'@mneia/cli': minor
---

Surface who asserted every item, and let a decision's history be read end to end.

`mneia log --chain <id>` renders a decision's full supersede history oldest first, with the
rationale, provenance and confidence at each step. When two humans disagree, no revision is marked
`in force` — §10.4 leaves that to the actors involved. A step where a human-confirmed revision is
replaced by one that is not is flagged inline, per §10.1.

`mneia status` now names the asserter on every stale, disputed and unanswered line, and carries
`assertedBy` in `--json`.

The rehydration slice previously rendered whether an item was confirmed but not who asserted it, so
an agent-asserted item and a human-asserted one were byte-identical. Both renderers now emit actor
kind and display name, read from the `actor` table rather than any payload, and strip the delimiters
from display names so a name can no longer forge a second provenance group that reads as
human-confirmed.

Scoring gains a per-kind `decay_after` default, so freshness applies to items that never set one. A
constraint defaults to never decaying, keeping load-bearing constraints in every slice regardless of
age.
