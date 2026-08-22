---
"@mneia/core": minor
"@mneia/cli": minor
"@mneia/mcp-server": minor
---

Cut what a checkpoint costs to run, without changing what it does.

The extraction prompt now lists existing items by title alone. Their ids were never read
back — no candidate field names an existing item and the system prompt tells the model not
to judge replacement — so a rendered UUID cost about 20 tokens each and bought nothing. At
the 200-item limit the prefix drops from roughly 7,400 tokens to 3,600.

`ExtractionProviderRequest` gains an optional `cacheKey`, so a caller can group provider
prompt-cache lookups. Optional, so existing implementers are unaffected.
