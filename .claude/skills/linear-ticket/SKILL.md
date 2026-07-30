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
4. `save_issue` with `state: "In Progress"`.
5. Branch: `git switch -c mne-<n>-<short-slug>`.

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
   **No `Co-Authored-By`. No "Generated with Claude Code".**
4. Push and open a PR. Body links the ticket and states which *Done when* clause it satisfies.
5. `save_issue` with `state: "Done"`.
6. Report the PR URL to the founder.

## Things that must never happen silently

| Situation | Required |
|---|---|
| Scope grew | New ticket, linked |
| Ticket turned out wrong | Cancel with a comment saying why — do not just close |
| Request hits a §19 non-goal | Log under MNE-164 with a written ruling |
| An open decision got made | Record in its `DECISION` ticket **and** update `vision.md` §20 |
| A kill-criterion indicator moved | Comment on the `RISK` ticket — those never close |
