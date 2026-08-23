---
"@mneia/core": patch
"@mneia/cli": patch
"@mneia/mcp-server": patch
---

Fix the defects the three core operations were carrying, several of which lost work silently.

**A rehydration slice now costs what it says it costs.** `countItemTokens` charged a flat six
tokens of markup per item, which covered `- ` and nothing else — not the provenance meta line,
not the `**LOAD-BEARING**` marker, not per-line body indent. Measured, a forty-item slice
reported `1200/3000` while rendering 2,405 tokens, so `mneia_rehydrate` at its 4,000-token
default was quietly spending about 8,000 tokens of the caller's context and printing a false
number in the header. It now prices the exact text the renderer emits. At the same budget a
slice carries roughly half as many items, because the old count was wrong rather than because
anything got stingier. Handoffs share the packer and shrink the same way.

**Checkpoint stops losing turns.** An upload that did not reach back to the stored watermark
was refused outright, so for a transcript that had moved on those turns were gone for good.
The upload is now always extracted, and the watermark is held rather than moved when nothing
in the request proves forward progress — monotonic by construction. Separately, a single turn
over the wire limit, or more than five thousand turns since the watermark, made a session
permanently un-checkpointable: the oversized turn was in every later upload too, so the
rejection repeated forever. Both are now trimmed or split at the client with the loss made
visible in the prompt.

**Extraction degrades instead of stopping.** A revoked, unpaid, or forbidden model key threw
before the fallback vendor was ever tried, taking every checkpoint down until a redeploy —
while an ordinary rate limit on the same key failed over correctly. A vendor refusing the
account is now treated as worth falling back from; a refused request still fails terminally.

**Non-English candidates survive.** The similarity normaliser stripped everything outside
`[a-z0-9]`, so a Chinese, Japanese, Cyrillic, Greek, or Arabic title normalised to the empty
string and was discarded as carrying nothing a reader could act on. Accented Latin was split
into fragments that matched the wrong things.

**A handoff reads the way it was written.** The interop importer cut a title at the first
markdown soft-wrap and then repeated the whole bullet as the body, which is why received
artifacts printed each constraint twice. The renderer escaped inline `**bold**` as though it
opened a block, leaving a literal backslash in the artifact. The "Superseded recently" block
was capped before it was windowed, and on the wrong ordering, so a decision superseded
yesterday could be hidden behind five older ones — the one block whose whole purpose is to
stop a receiver re-proposing a rejected approach.
