---
'@mneia/core': minor
'@mneia/cli': minor
---

MNE-271: `mneia init` can create a project, so the CLI loop can be entered at all.

`init` was bound to a stub that always rejected, and there was no project-creation path
anywhere — `/api/v1/projects` was `GET` only and `createProject` returned `501`. A new
`POST /api/v1/projects` creates or attaches idempotently on the workspace slug, the workspace
is resolved from the bearer token rather than the payload, and the CLI is wired to it.

Also fixes rehydration ranking: the hosted rehydrate route imported an embedding provider and
never passed it, so the semantic weight scored every item identically and the task string
affected nothing about which items came back (MNE-272).
