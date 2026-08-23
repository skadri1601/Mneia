# Cross-client MCP Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a safe `mneia mcp install/list/uninstall` workflow and a client-specific public setup experience whose copied prompt reaches a verified rehydration.

**Architecture:** The CLI wraps `add-mcp` 2.0.0 behind a narrow adapter and exposes one shipped `mcp` command with three subcommands. The site keeps client setup as typed static content and renders it through one small accessible client component, so prompts are server-rendered while tab/copy behavior stays isolated.

**Tech Stack:** TypeScript 5.9, Node.js 20.11+, add-mcp 2.0.0, Vitest 4, React 19, Next.js 15, CSS Modules, Changesets

---

## File map

- Modify `packages/cli/package.json` and `pnpm-lock.yaml`: add `add-mcp`.
- Create `packages/cli/src/mcp-config.ts`: isolate the third-party installer API.
- Create `packages/cli/src/commands/mcp.ts`: parse subcommands and render results.
- Create `packages/cli/src/commands/mcp.test.ts`: command behavior and safety tests.
- Modify `packages/cli/src/bin.ts` and `packages/cli/src/router.ts`: register the shipped command.
- Create `apps/site/src/content/client-setup.ts`: typed client commands, prompts, and verification text.
- Create `apps/site/src/content/client-setup.test.ts`: content completeness and prompt-boundary tests.
- Create `apps/site/src/components/ClientSetup.tsx` and `ClientSetup.module.css`: accessible tabs and clipboard behavior.
- Create `apps/site/src/components/ClientSetup.test.tsx`: interaction and failure tests.
- Modify `apps/site/src/components/DocBody.tsx` and docs content files: embed the setup experience and correct stale copy.
- Create `.changeset/bright-agents-connect.md`: minor client-package release note.

### Task 1: Add the installer dependency and adapter

**Files:**
- Modify: `packages/cli/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/cli/src/mcp-config.ts`
- Test: `packages/cli/src/commands/mcp.test.ts`

- [ ] **Step 1: Add a failing adapter test through the command seam**

Define a fake `McpConfigApi` in `mcp.test.ts` and assert an install request becomes the canonical server definition:

```ts
expect(config.upsert).toHaveBeenCalledWith('codex', 'mneia', {
  command: 'mneia-mcp',
  args: [],
  env: {},
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the command does not exist**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/src/commands/mcp.test.ts`

Expected: FAIL resolving `./mcp.js`.

- [ ] **Step 3: Install and pin the verified dependency**

Run: `pnpm add add-mcp@2.0.0 --filter @mneia/cli`

Expected: `packages/cli/package.json` contains `"add-mcp": "2.0.0"` and the lockfile resolves the Apache-2.0 package.

- [ ] **Step 4: Implement the narrow adapter**

Create `mcp-config.ts` with MNEIA-owned result types and these operations:

```ts
import {
  detectGlobalAgents,
  getAgentTypes,
  listInstalledServers,
  removeServer,
  upsertServer,
  type AgentType,
  type McpServerConfig,
} from 'add-mcp';

export const MNEIA_MCP_SERVER: McpServerConfig = {
  command: 'mneia-mcp',
  args: [],
  env: {},
};

export const mcpConfigApi = {
  supportedClients: (): readonly AgentType[] => getAgentTypes(),
  detectClients: (): Promise<readonly AgentType[]> => detectGlobalAgents(),
  upsert: (client: AgentType) => upsertServer(client, 'mneia', MNEIA_MCP_SERVER),
  list: (clients?: AgentType[]) => listInstalledServers({ global: true, agents: clients }),
  remove: (client: AgentType) => removeServer(client, 'mneia'),
};
```

- [ ] **Step 5: Commit the dependency and adapter**

```text
git add packages/cli/package.json pnpm-lock.yaml packages/cli/src/mcp-config.ts packages/cli/src/commands/mcp.test.ts
git commit -m "MNE-79: add the cross-client MCP config adapter"
```

### Task 2: Implement `mneia mcp install/list/uninstall`

**Files:**
- Create: `packages/cli/src/commands/mcp.ts`
- Modify: `packages/cli/src/commands/mcp.test.ts`
- Modify: `packages/cli/src/bin.ts`
- Modify: `packages/cli/src/router.ts`

- [ ] **Step 1: Add failing parsing and output tests**

Cover:

```ts
await command.run(invocation(['install'], { client: 'codex', yes: true }));
await command.run(invocation(['list'], { client: 'codex' }, true));
await command.run(invocation(['uninstall'], { client: 'codex', yes: true }));
```

Assert unknown clients name the received value and supported values; `--client` and `--all` are mutually exclusive; missing detected clients point to `--client`; identical installs succeed idempotently; partial failures return `EXIT_FAILED`; JSON exposes `changed`, `unchanged`, `removed`, and `failed` arrays.

- [ ] **Step 2: Run the focused test and confirm the behavior is absent**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/src/commands/mcp.test.ts`

Expected: FAIL for missing command behavior.

- [ ] **Step 3: Implement strict subcommand parsing**

Use this public usage:

```text
mneia mcp <install|list|uninstall> [--client <client> | --all] [--yes] [--json]
```

Reject extra positionals, boolean `--client`, `--yes` on `list`, and an absent subcommand with a `CliError('usage', ...)` that includes the usage line.

- [ ] **Step 4: Implement target resolution and command execution**

Resolve explicit clients against `supportedClients()`. `--all` uses the complete current list. With neither flag, call `detectClients()`; if none are detected, return a corrective error instead of guessing. Call only adapter methods and render deterministic sorted results.

- [ ] **Step 5: Register the command as shipped**

Add `mcp` to `SHIPPED_COMMAND_NAMES`, import `mcpCommand` in `bin.ts`, and include it in `commands`.

- [ ] **Step 6: Run command and router tests**

Run: `node node_modules/vitest/vitest.mjs run packages/cli/src/commands/mcp.test.ts packages/cli/src/index.test.ts`

Expected: PASS with no real home-directory writes.

- [ ] **Step 7: Commit the CLI command**

```text
git add packages/cli/src/commands/mcp.ts packages/cli/src/commands/mcp.test.ts packages/cli/src/bin.ts packages/cli/src/router.ts
git commit -m "MNE-79: install MNEIA across MCP clients"
```

### Task 3: Define the client setup content and prompt contract

**Files:**
- Create: `apps/site/src/content/client-setup.ts`
- Create: `apps/site/src/content/client-setup.test.ts`

- [ ] **Step 1: Write failing content tests**

Require exactly these first-class keys:

```ts
expect(CLIENT_SETUPS.map((client) => client.id)).toEqual([
  'codex',
  'claude-code',
  'claude-desktop',
  'cursor',
  'gemini-cli',
  'vscode',
  'windsurf',
  'other',
]);
```

For every prompt, assert it contains the selected `mneia mcp install --client ... --yes` command, `mneia_rehydrate`, login/init, credential and endpoint prohibitions, and no other first-class client's install command.

- [ ] **Step 2: Run the content test and confirm it fails**

Run: `node node_modules/vitest/vitest.mjs run apps/site/src/content/client-setup.test.ts`

Expected: FAIL resolving `client-setup`.

- [ ] **Step 3: Implement typed static setup content**

Define:

```ts
export type ClientSetup = {
  id: string;
  label: string;
  title: string;
  summary: string;
  installerClient: string | null;
  automaticCommand: string;
  manualLabel: string;
  manualConfig: readonly string[];
  verification: string;
};

export function setupPrompt(client: ClientSetup): string;
export const CLIENT_SETUPS: readonly ClientSetup[];
```

Keep the prompt generator in this server-safe file so the complete strings exist without hydration.

- [ ] **Step 4: Run the content tests**

Expected: all client content and prompt-boundary tests PASS.

- [ ] **Step 5: Commit the content contract**

```text
git add apps/site/src/content/client-setup.ts apps/site/src/content/client-setup.test.ts
git commit -m "MNE-79: define agent-ready MCP setup prompts"
```

### Task 4: Build the accessible client selector and copy behavior

**Files:**
- Create: `apps/site/src/components/ClientSetup.tsx`
- Create: `apps/site/src/components/ClientSetup.module.css`
- Create: `apps/site/src/components/ClientSetup.test.tsx`
- Modify: `apps/site/src/components/DocBody.tsx`
- Modify: `apps/site/src/content/docs/types.ts`

- [ ] **Step 1: Write failing interaction tests in jsdom**

Cover initial Codex rendering, selecting Gemini, arrow-key tab navigation, primary prompt copy, adjacent manual-command copy, copied live-region text, and rejected clipboard promises.

- [ ] **Step 2: Run the component test and confirm it fails**

Run: `node node_modules/vitest/vitest.mjs run apps/site/src/components/ClientSetup.test.tsx`

Expected: FAIL resolving `ClientSetup`.

- [ ] **Step 3: Implement the client component**

Use `useState` only for selected tab and copy status. Render buttons with `role="tab"`, panels with `role="tabpanel"`, stable IDs, 44px targets, and an `aria-live="polite"` status. Copy only one of three explicit strings: selected prompt, automatic command, or manual config.

- [ ] **Step 4: Add a typed docs block**

Extend `DocBlock` with `{ kind: 'client-setup' }` and render `<ClientSetup clients={CLIENT_SETUPS} />` from `DocBody`. Keep all client content passed as static props.

- [ ] **Step 5: Style only with existing tokens**

Use `--tile-*`, `--editor-*`, `--primary`, `--rounded-*`, `--space-*`, and existing typography variables. Do not add literal colours, shadows beyond the existing artifact shadow, or hover-only behavior.

- [ ] **Step 6: Run component and content tests**

Expected: PASS, including clipboard rejection and keyboard navigation.

- [ ] **Step 7: Commit the UI**

```text
git add apps/site/src/components/ClientSetup.tsx apps/site/src/components/ClientSetup.module.css apps/site/src/components/ClientSetup.test.tsx apps/site/src/components/DocBody.tsx apps/site/src/content/docs/types.ts
git commit -m "MNE-79: add the client setup experience"
```

### Task 5: Correct the public journey and release metadata

**Files:**
- Modify: `apps/site/src/content/docs/quickstart.ts`
- Modify: `apps/site/src/content/docs/integrations.ts`
- Modify: `apps/site/src/content/docs/mcp.ts`
- Modify: `apps/site/src/content/faq.ts`
- Modify: `packages/cli/README.md`
- Modify: `packages/mcp-server/README.md`
- Create: `.changeset/bright-agents-connect.md`

- [ ] **Step 1: Add or extend stale-copy tests**

Assert published copy names the real client installer, handoff is available, and the current command/tool counts come from or agree with the shipped registries.

- [ ] **Step 2: Run docs checks and capture the expected stale failures**

Run: `pnpm check:docs`

- [ ] **Step 3: Update the quickstart and integration pages**

Make `mneia mcp install` the primary setup after init. Embed the client selector on Integrations. Link Quickstart and MCP reference to `#mcp-clients`. Keep exact native fallbacks and verification text.

- [ ] **Step 4: Correct FAQ and npm READMEs**

Remove claims that handoff is unavailable or that the MCP server exposes an obsolete tool count. Document `mneia mcp` with the current shipped surface.

- [ ] **Step 5: Add the minor changeset**

Create a changeset marking `@mneia/cli`, `@mneia/mcp-server`, and `@mneia/core` as `minor` with a concise note about cross-client MCP setup and agent-ready docs.

- [ ] **Step 6: Run docs and focused site tests**

Run: `pnpm check:docs` and the client setup Vitest files.

- [ ] **Step 7: Commit published copy and metadata**

```text
git add apps/site/src/content packages/cli/README.md packages/mcp-server/README.md .changeset
git commit -m "MNE-79: make MCP onboarding copy-pasteable"
```

### Task 6: Verify the product and present localhost acceptance

**Files:**
- No new files expected

- [ ] **Step 1: Run focused CLI and site tests**

Run the MCP command, prompt content, and component test files with Vitest. Expected: zero failures.

- [ ] **Step 2: Run package and site compilation**

Run: `pnpm --filter @mneia/cli build`, `pnpm --filter @mneia/site typecheck`, and `pnpm --filter @mneia/site build`.

- [ ] **Step 3: Run repository checks**

Run: `pnpm format:check`, `pnpm lint:ci`, `pnpm check:policy`, `pnpm check:publish`, and `git diff --check`.

- [ ] **Step 4: Exercise the CLI against disposable configuration**

Point the supported temporary-home mechanism at a disposable directory and verify install → list → uninstall for representative JSON and TOML clients. Never touch the user's real MCP configs during this test.

- [ ] **Step 5: Start the site locally and inspect real UI**

Run: `pnpm --filter @mneia/site dev`. Inspect `/docs/quickstart`, `/docs/integrations`, and `/docs/mcp` at desktop and mobile widths. Verify every tab and copy target.

- [ ] **Step 6: Request code review and resolve concrete findings**

Use the requesting-code-review skill, verify any reported failure locally, and change only confirmed issues.

- [ ] **Step 7: Commit any verification repairs, push, and open the PR**

The PR body contains `Closes MNE-79`, verification evidence, the localhost acceptance result, and the exact remaining unverified client surfaces if any.
