---
'@mneia/cli': minor
---

MNE-12: give the interactive session a proper masthead.

The session opened with three unstyled lines. It now leads with a logo beside
the facts that matter — version, who you are, where you are, which project —
and drops the redundant "signed in as" line. A workspace whose name is just
your own name is no longer printed twice.

Colour is brand accent `#2997ff` on the logo and prompt, bold on the name, dim
on everything else. It respects `NO_COLOR` and `TERM=dumb`, and is off whenever
stdout is not a terminal. Per the CLI rule, meaning is never carried by colour
alone: a test strips every escape sequence and asserts the result is identical
to the unpainted banner.
