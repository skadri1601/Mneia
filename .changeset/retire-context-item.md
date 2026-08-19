---
'@mneia/core': minor
'@mneia/mcp-server': minor
'@mneia/cli': minor
---

Adds `mneia_retire`, which takes a stored item out of every future rehydration slice and handoff
because it was never right or is no longer true — a doc fragment captured as a rule, a constraint
describing a bug that has since been fixed, a fact that has gone stale.

It is a correction, not a deletion: the row stays, the timeline still shows it, and the reason is
recorded on the retiring checkpoint. Only a human actor may retire, because retiring overrides what
a human recorded. Backed by `retireContextItem` on the store and `POST /api/v1/items/retire`.
