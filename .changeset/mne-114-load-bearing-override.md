---
'@mneia/core': minor
'@mneia/cli': minor
---

Suggest `load_bearing` with the signal behind it, and let a human overturn it in one keystroke.

§9 calls `load_bearing` the flag that decides whether a contradiction blocks or merely logs, and
getting it right is most of the product quality. Until now the whole suggestion was one sentence of
extraction prompt: a bare boolean, with no signal a reviewer could check and nothing recorded when
they disagreed.

The extraction prompt now explains what the flag costs a reader and names the five signals that
justify it. A deterministic check — `suggestLoadBearing`, run over every kept candidate by
`applyPrecisionFilter` — reads the same five out of the candidate's own text, so the suggestion no
longer depends solely on the model. It only ever promotes; demoting stays a human's decision.

`mneia checkpoint` shows the signal beside the flag, explains it under `?`, and takes `l` to
overturn it without entering the edit loop. Every overturned suggestion emits the new §17 event
`checkpoint.load_bearing_overridden`, carrying what was suggested, what the human chose, the signal
behind the suggestion, the item kind, and nothing else — no title, no body, no free text. Agreeing
with the suggestion emits nothing, because agreement is not an override.
