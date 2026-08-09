---
'@mneia/core': minor
'@mneia/cli': patch
---

MNE-271: `forbidden` joins the API error vocabulary, and the CLI names the fix.

`POST /api/v1/projects` refuses a member creating a project that does not exist yet, so the wire
needed a code for it. `403` previously decoded as `invalid_token`, which would have told a
customer their credentials were bad when the real answer is that only a workspace lead can create
a project. The CLI surfaces the server's message and tells them to ask a lead.
