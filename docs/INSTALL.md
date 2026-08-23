# Install

Fresh machine to a working rehydrate. MNE-80's test is **under five minutes without hand-holding**, so
every step below is copy-pasteable and nothing is left to the reader to infer.

Per-client configuration and what has actually been verified in which client: [`CLIENTS.md`](./CLIENTS.md).

> **A note on an out-of-date phrase.** MNE-80 was written asking for "no required API key for the
> offline path". There is no offline path — §11.1 made Mneia hosted-only on 2026-07-28 and revoked
> self-hostability and offline operation as claims. An account is required. Do not restate the old
> promise anywhere public.

## Requirements

- **Node 20.11 or newer.** `node --version` to check.
- **An account** at [app.mneia.dev](https://app.mneia.dev) with a **verified email address**. Signup
  refuses to provision a workspace without one (MNE-250), so verify the address before continuing.

Nothing else. No database to install, no daemon, no sync step.

## 1. Sign in — about one minute

```bash
npx @mneia/cli login
```

Opens a browser, shows a code, waits for approval. The credential lands in `~/.mneia/credentials`.

In CI, skip it and set `MNEIA_TOKEN` in the environment instead. The surface is identical.

## 2. Bind the repository to a project — seconds

From the root of the repository you want memory for:

```bash
npx @mneia/cli init
```

Creates or binds a project and imports existing constraints from `AGENTS.md` if there is one.

```bash
npx @mneia/cli status
```

Confirms who you are, which workspace and project you are bound to, and what is unanswered. If this
prints an account and a project, the hosted half is working and nothing below can fail for auth
reasons.

## 3. Add the MCP server to your agent — about two minutes

Install the two npm clients globally if step 1 used `npx`, then let Mneia detect and configure the
installed MCP clients:

```bash
npm install -g @mneia/cli @mneia/mcp-server
mneia mcp install
mneia mcp list
```

To configure only the client the user selected, pass its id:

```bash
mneia mcp install --client codex --yes
```

The public [client setup page](https://mneia.dev/docs/integrations#mcp-clients) has separate tabs for
Codex, Claude Code, Claude Desktop, Cursor, Gemini CLI, VS Code, Windsurf, and other MCP clients.
Each tab copies one complete prompt for that client only, plus its native manual fallback.

Restart the client. It should list eleven tools: `mneia_rehydrate`, `mneia_assert`, `mneia_retire`,
`mneia_checkpoint`, `mneia_search`, `mneia_handoff_create`, `mneia_handoff_receive`,
`mneia_handoff_inbox`, `mneia_team`, `mneia_sessions`, `mneia_review_queue`.

Fewer than eleven, or a server that will not start at all, means the build is older than the tool
list — `@mneia/mcp-server@0.7.0` shipped unable to start. Pin a version at or above `0.12.0`.

That count is checked, not maintained by hand: `pnpm check:docs` fails when this list and
`SHIPPED_TOOL_NAMES` disagree.

## 4. Prove the loop — about one minute

Ask the agent to call `mneia_rehydrate` for this project. On a project with nothing recorded yet it
returns an empty slice, which is a correct answer and still proves the path. To see it carry something:

```bash
npx @mneia/cli checkpoint
```

Review what it proposes, keep at least one item, then rehydrate again and the item comes back in the
slice. That round trip — checkpoint in one session, rehydrate in the next — **is** the product.

## Checking the whole thing at once

`pnpm verify:journey` walks the steps above against a temporary `MNEIA_HOME` and a temporary
repository, times each command, and prints the `.mneia/config.json` that `init` wrote. It never
touches your real `~/.mneia`, so it is safe to run on a machine already signed in.

```bash
pnpm verify:journey                 # against the published @mneia/cli@latest
pnpm verify:journey --local         # against the workspace build
pnpm verify:journey --in .          # run it in this repo, so checkpoint has a session to read
```

With no credential it prints the one `login` command to run and exits 2 rather than guessing.
`checkpoint` is advisory: it discovers an agent session for the working directory, so a fresh
temporary repository has none — use `--in` with a repository you have an open session in.

## When it does not work

| Symptom | Cause | Fix |
|---|---|---|
| Client reports the server failed to start | No credential the server can find | It names all three places it looked. Set `MNEIA_TOKEN` in the **client's** server config — the client does not inherit your shell |
| `mneia login` never completes | Approval opened in a browser signed in as someone else, or the email is unverified | Verify the address, then approve in the same browser profile |
| Tools do not appear in a client | The wrong native config format or a client that was already open | Run `mneia mcp install --client <client> --yes`, restart the client, then run `mneia mcp list` |
| Tools appear, every call fails with a store error | Token expired or revoked | `npx @mneia/cli whoami`, then log in again |
| `rls` is not `enforced` at `/api/health` | A privileged connection reached the app | Stop and read `AGENTS.md` §RLS. Do not work around it |

`curl -s https://app.mneia.dev/api/health` distinguishes "my machine" from "the service" in one step.

## Running against your own Postgres

Not a supported product configuration — it exists for working **on** Mneia, not with it. It needs a
role that row-level security applies to; a superuser is refused rather than silently trusted (MNE-186).

```bash
pnpm db:provision-app-role --apply     # prints a connection string for a NOBYPASSRLS role
```

Then `~/.mneia/local.json`:

```json
{
  "databaseUrl": "postgres://mneia_app:...@host:5432/mneia",
  "workspaceId": "<uuid>",
  "agentActorId": "<uuid>"
}
```

That directory defaults to `~/.mneia`. Set `MNEIA_HOME` to an absolute path to put it elsewhere — the
CLI and the MCP server both honour it, so a login written under one is found by the other. That is
the supported way to run two configurations side by side.
