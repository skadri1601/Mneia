---
'@mneia/cli': minor
'@mneia/core': minor
---

Extraction now sees the whole session. `mneia checkpoint -m` reaches the model instead of only
being stored, each chunk of a long session is told what earlier chunks already found, and the
"already in project memory" list is context rather than an instruction to stay silent —
duplicates were always removed downstream, so suppressing them in the prompt only lost work.
