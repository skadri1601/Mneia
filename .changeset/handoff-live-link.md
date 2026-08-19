---
'@mneia/core': minor
---

A handoff now records the item set it was rendered from. `handoff_item` gets its first writer, `listHandoffItems` reads it back with the section each item landed in, and the CLI surfaces the frozen artifact alongside where those items stand today.
