---
'@mneia/core': patch
'@mneia/cli': patch
---

Handoff artifacts are now ranked and packed under a token budget instead of rendering every item the
project holds, and the header reports what was left out. Active load-bearing constraints still appear
regardless of budget pressure, and the `Superseded recently` block is bounded on its own.

`mneia init` no longer marks a constraint scraped from `AGENTS.md`, `CLAUDE.md` or `.cursor/rules` as
load-bearing — reading a bullet out of a file does not make it binding — and no longer imports
term-definition rows such as `**Rehydrate** — assemble the context slice` as constraints at all.
