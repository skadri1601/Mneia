---
'@mneia/core': minor
---

Assemble and store a handoff. `assembleHandoff` builds the artifact from project state and writes it; the remote store's three `createHandoff` / `receiveHandoff` / `getHandoff` refusals are replaced by real calls against the hosted API.
