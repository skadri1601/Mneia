---
'@mneia/core': patch
'@mneia/cli': patch
'@mneia/mcp-server': patch
---

Say who asserted every item, and stop a display name from forging that answer.

Search results named neither the actor nor their kind, so an agent-asserted item and a human-asserted
one were byte-identical — while the tool description already claimed it returned provenance. `mneia
log`, `mneia log --chain` and `mneia status` signalled "unconfirmed" by omitting the field, which a
reader cannot distinguish from a renderer that forgot. All of them now say `human-confirmed` or
`not human-confirmed` outright, and search results carry the asserting actor in both the rendered
list and the structured output.

Display names are supplied by users, and every renderer interpolated them straight into a delimited
field. An agent named `claude-code] [human · Saad · (human) · human-confirmed` could produce output
reading as a confirmed human assertion. The sanitizer that prevents this had reached four
independent copies, two of which had already drifted apart; it is now one function used everywhere.
