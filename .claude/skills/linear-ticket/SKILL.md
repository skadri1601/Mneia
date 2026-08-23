---
name: linear-ticket
description: Start, work, and close a Linear ticket correctly. Use whenever beginning or finishing any unit of work in this repo, when the user names an MNE-nnn ticket, or when you discover work that has no ticket yet.
---

# Working a Linear ticket

Linear is the source of truth for status (`ROADMAP.md` §0). Work that never appears there did not
happen, from the perspective of anyone reading the project later — including the founder in four
months, which is exactly the failure this company exists to fix.

Team `Mneia`, prefix `MNE`. States: `Backlog` → `Todo` → `In Progress` → `Done`.

## Starting

1. **Find it.** `list_issues` filtered by project and state, or `get_issue` if you have the ID.
2. **Read the description in full.** Every ticket carries its `vision.md` reasoning. Do not re-derive
   it and do not contradict it — if you disagree, say so before starting, not after.
3. **Note the *Done when* clause.** That is the acceptance criterion. There is always one.
4. `save_issue` with `state: "In Progress"`, and **attach any PR that already exists for this work** —
   see *Attach the PRs* below.
5. **Check the lane first** (`CLAUDE.md` > Git lanes, MNE-182). Docs-only work — `*.md`, `docs/**`,
   `.claude/**` other than `settings.json` and `hooks/` — commits **direct to `main`**; skip to
   *Finishing* and ignore the branch and PR steps. Everything else needs a branch:
   ```
   git switch -c <type>/mne-<n>-<slug>     # feat fix docs chore refactor spike test
   ```
   e.g. `feat/mne-42-context-item-schema`. The `mne-<n>` segment is what Linear links on, and
   `.claude/hooks/git-lane-guard.mjs` rejects a branch that does not match.

## While working

- **Found work with no ticket?** Create one — `save_issue` with `team: "Mneia"`, the right `project`,
  and `parentId` set to the epic. Never widen the ticket you are on.
- **Made a decision a future reader would need?** `save_comment` on the ticket. A commit message is
  harder to find and a code comment is forbidden here (`typescript-style.md`).
- **Hit a §19 non-goal?** Stop and run the `scope-check` skill.
- **Blocked?** Set `state: "Todo"` and comment with what is blocking. Do not leave things parked in
  `In Progress` as a form of optimism.

## Finishing

1. **Verify the *Done when* clause is actually satisfied.** Not "the code is written," not "it should
   work." Run the thing.
2. `pnpm test && pnpm typecheck && pnpm lint` — all green.
3. Commit. Reference the ticket and cite the `vision.md` section:
   ```
   MNE-42: add context_item with bi-temporal validity

   Implements §9 provenance, trust, and bi-temporal columns on hosted Postgres.
   Bi-temporality ships now because retrofitting it onto a live store is
   close to impossible (§9 design notes).
   ```
   **No `Co-Authored-By`. No "Generated with Claude Code".** The `MNE-<n>:` prefix is required —
   the hook rejects a commit message without one.
4. **Docs lane:** push `main` and stop. **Code lane:** push the branch and open a PR whose body
   contains `Closes MNE-<n>` (or `Part of MNE-<n>` if it does not finish the ticket) and states which
   *Done when* clause it satisfies.
5. **Attach the PRs to the ticket** — see below. Do this before moving the state, not after.
6. `save_issue` with `state: "Done"`.
7. Report the PR URL to the founder — or, on the docs lane, the commit SHA that landed on `main`.

## Attach the PRs

Founder directive, 2026-08-23. **Every ticket a session touches carries its PR URLs as Linear
attachments — on pickup, and again on the way to `Done`.**

```
save_issue({ id: "MNE-42", links: [{ url: "https://github.com/…/pull/195", title: "…" }] })
```

`links` is append-only, so adding one never removes an existing attachment.

**Why an attachment and not a comment.** When production breaks and someone is tracing it, they need
to filter from the symptom back to *which PR did this* and *which ticket it belonged to*. A PR URL
inside comment prose is something a human has to read; an attachment is structured and filterable.
Without it the chain ticket → PR → commit → deployed behaviour has a gap exactly where an incident
needs it most.

Rules:

- **Every PR that contributed, not just the last one.** Several PRs against one ticket is normal here.
- **Title it so it reads without opening it.** Say what the PR did.
- **Say so in the title when a PR does *not* satisfy the ticket's *Done when* clause.** This matters
  more than it sounds: the commit hook rejects any subject without an `MNE-nnn`, and the workspace is
  at its free issue limit, so work is routinely filed under the nearest existing ticket rather than a
  true one. That number then reads as progress to anyone tracing later. Add a comment saying which
  clauses are and are not touched.
- Attaching a PR **does not** close the ticket. Merging one never closes it either — verify the
  *Done when* clause yourself.

## Things that must never happen silently

| Situation | Required |
|---|---|
| Scope grew | New ticket, linked |
| Ticket turned out wrong | Cancel with a comment saying why — do not just close |
| Request hits a §19 non-goal | Log under MNE-164 with a written ruling |
| An open decision got made | Record in its `DECISION` ticket **and** update `vision.md` §20 |
| A kill-criterion indicator moved | Comment on the `RISK` ticket — those never close |
