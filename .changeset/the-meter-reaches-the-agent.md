---
"@mneia/core": minor
"@mneia/cli": minor
"@mneia/mcp-server": minor
---

Show what a workspace has spent, on every surface — including the one an agent can see.

One percentage, `max(turns used / turn allowance, extractions used / extraction allowance)`, so
the number tracks whichever dial is closest to binding. The embedding dial is recorded so cost
stays computable and is never shown: a customer cannot act on it, and letting it move the
headline number would show a bar shifting for a reason nobody can explain.

`mneia status` renders the line, and `--json` carries the raw dials, the percentage, and which
dial is binding — so a script never has to re-derive it. It warns at 80% in words rather than
colour alone, and an older server that has no meter yet simply prints nothing rather than an
error.

The meter also rides on `mneia_checkpoint`, `mneia_assert` and `mneia_rehydrate` in
`structuredContent`, because a number only the terminal can see is invisible to the agent doing
the spending. No new tool name, so the registry stays as it was. Reading it can never fail a
write that already succeeded — an unreachable meter reports nothing rather than turning a
recorded checkpoint into a reported failure. Rehydrate races the read against slice assembly
rather than waiting on it, so the §12.1 budget is untouched, and its rendered markdown is
byte-identical with the meter present or absent.

`UsageWireSchema` in `@mneia/core` is the shape that crosses the wire. It has no embedding
field at all, so the dial that must not be displayed cannot be received in the first place.
