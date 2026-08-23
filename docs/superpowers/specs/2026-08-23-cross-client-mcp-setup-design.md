# Cross-client MCP setup design

**Ticket:** MNE-79  
**Date:** 2026-08-23  
**Status:** Approved for implementation

## Outcome

A new user can install MNEIA, bind a repository, register the MCP server in the agent they already use, and prove a real rehydration without learning that client's configuration format. The same journey is available as a copyable, client-specific agent prompt in the public documentation.

The primary command surface is:

```text
mneia mcp install [--client <client>] [--all] [--yes] [--json]
mneia mcp list [--client <client>] [--json]
mneia mcp uninstall [--client <client>] [--all] [--yes] [--json]
```

## Product precedent

The experience deliberately combines the strongest common parts of four live MCP onboarding flows:

- Stripe: client tabs, one-click actions where supported, copyable manual configuration, and page-level agent-readable content.
- Clerk: one owned installer command, detected clients, explicit list/uninstall commands, client-specific manual fallbacks, and verification.
- Neon: the Apache-2.0 `add-mcp` library for cross-client detection and safe configuration updates.
- Sentry: separate cloud/client choices, copied snippets, authentication steps, and an explicit connection check.

MNEIA must not claim an install succeeded because a config file was written. Completion requires the selected client to be listed as configured, followed by a real `mneia_rehydrate` call from the agent.

## CLI architecture

`mneia mcp` is one shipped top-level command with `install`, `list`, and `uninstall` subcommands. It uses `add-mcp` through a small MNEIA-owned adapter so the dependency's client names and result shapes do not leak into the rest of the CLI.

The adapter accepts one server definition: a user-global stdio server named `mneia` whose command is `mneia-mcp` and whose arguments and environment are empty. Authentication continues to come from `mneia login`; repository binding continues to come from `.mneia/config.json`. No credential is copied into an MCP client configuration.

The default interactive install detects supported clients and asks the user which ones to configure. `--client` is repeatable for deterministic setup, and `--all --yes` is the noninteractive path for agents. User-global installation is the default because the binaries and credentials are machine-level while repository selection remains directory-scoped.

Supported public client names initially include the live names provided by `add-mcp`, with first-class documentation for:

- `codex`
- `claude-code`
- `claude-desktop`
- `cursor`
- `gemini-cli`
- `vscode`
- `windsurf`

The CLI reports the dependency's remaining supported clients through help and JSON rather than hard-coding a false closed list in prose.

## Safety and failure behavior

- Existing unrelated MCP entries are preserved.
- Reinstalling the identical MNEIA entry is idempotent.
- A conflicting MNEIA entry requires explicit confirmation or `--yes`; it is never silently replaced.
- A malformed client configuration stops the operation and leaves the file unchanged.
- `uninstall` removes only the `mneia` entry from selected clients.
- A client-specific failure does not get converted into a private API or direct-file workaround.
- Human output names every client changed, skipped, or failed. JSON output exposes the same result as structured arrays.
- Unknown client names return the current supported list and a corrective command.

## Documentation architecture

`/docs/quickstart` remains the shortest happy path: install packages, login, init, run `mneia mcp install`, paste the selected setup prompt, and verify rehydrate.

`/docs/integrations` becomes the complete client setup surface. It contains an accessible client selector for Codex CLI/Desktop, Claude Code, Claude Desktop, Cursor, Gemini CLI, VS Code/Copilot, Windsurf, and generic stdio MCP.

Each selected client shows:

1. A primary **Copy setup prompt** action.
2. The complete prompt in a visible code surface.
3. The automatic `mneia mcp install` command.
4. A native command or configuration fallback.
5. Restart or reload instructions.
6. A real rehydrate verification step and the evidence the user should expect.

`/docs/mcp` remains the protocol and tool reference, links into client setup, and reports the current shipped tool surface. FAQ, help, and package-facing copy touched by the journey must agree with `SHIPPED_COMMAND_NAMES` and `SHIPPED_TOOL_NAMES`.

## Agent prompt contract

The copied prompt is generated from typed client setup data and instructs the selected agent to:

1. Verify Node.js 20.11 or newer.
2. Install current `@mneia/cli` and `@mneia/mcp-server` packages from npm when needed.
3. Run `mneia login`, pausing for human browser approval.
4. Run `mneia init` from the repository root without forcing a valid existing binding.
5. Register only the selected client with `mneia mcp install --client <client> --yes`.
6. Preserve unrelated MCP configuration.
7. Restart or reload the client when required.
8. Invoke `mneia_rehydrate` and report the slice ID, project binding, item count, and token usage.

The prompt forbids private endpoints, direct database access, credential-file reads, committed tokens, silent rebinding, and routing around a broken customer surface.

## UI behavior

The client selector follows the approved scratch prototype while using the existing site tokens and documentation layout. It is a small client component over static typed content; no data fetching or additional runtime dependency is required.

- Tabs are keyboard operable and use tablist semantics.
- The selected panel is linkable and remains usable without pointer input.
- **Copy setup prompt** copies only the selected client's complete prompt.
- Smaller copy actions copy only their adjacent command or configuration.
- Copy success changes the action label to **Copied** and announces through an ARIA live region.
- Clipboard denial leaves the source visible and reports a recoverable failure.
- Controls meet the existing 44px minimum target and collapse to one column on narrow screens.
- Agent-readable and search-indexed content must not depend on hydration to exist.

## Verification

CLI tests use temporary homes and representative client configurations. They cover detection, explicit selection, idempotent install, conflicting entries, malformed files, list output, uninstall isolation, JSON output, and Windows/POSIX path handling without touching the real user home.

Site tests cover every first-class client, selected-client rendering, keyboard selection, copy success, copy failure, exact prompt boundaries, responsive structure, and stale published claims. The final verification includes focused tests, package builds, site typecheck/build, formatting, lint, policy checks, and manual localhost acceptance at desktop and mobile widths.

The change adds a minor changeset because `mneia mcp` is a new client feature under the repository's version scale.
