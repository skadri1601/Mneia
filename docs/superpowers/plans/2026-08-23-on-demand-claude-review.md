# On-demand Claude PR review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Route the exact manual `@claude review` comment to Anthropic's official specialist review plugin while preserving ordinary generic Claude requests.

**Architecture:** Keep the existing interactive workflow for general `@claude` requests and exclude one reserved exact command from its issue-comment predicate. Add a separate workflow subscribed only to created issue comments, with explicit pull-request/open/exact-body guards and a fixed `/code-review:code-review ... --comment` prompt after installing Anthropic's official plugin marketplace.

**Tech Stack:** GitHub Actions YAML, `anthropics/claude-code-action@v1`, Node.js assertion script, pnpm scripts, Biome.

---

### Task 1: Add an executable trigger-contract check

**Files:**
- Create: `scripts/check-claude-review-workflow.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the contract checker**

Read both workflow files as UTF-8 and assert the review workflow has only `issue_comment.created`, checks `github.event.issue.pull_request`, checks `github.event.issue.state == 'open'`, compares the trimmed body to `@claude review`, installs `code-review@claude-code-plugins`, and invokes the command with `--comment`. Assert it has no `pull_request`, `push`, or `schedule` trigger and that the generic workflow explicitly excludes the exact review command.

- [ ] **Step 2: Add the package command**

Add `check:claude-review`: `node scripts/check-claude-review-workflow.mjs` beside the existing repository check scripts.

- [ ] **Step 3: Run the checker before workflows exist**

Run `pnpm.cmd check:claude-review`. Expected: fail with a missing review workflow or contract assertion, proving the checker is testing the intended contract.

### Task 2: Reserve the exact command in the generic workflow

**Files:**
- Modify: `.github/workflows/claude.yml`

- [ ] **Step 1: Narrow the issue-comment predicate**

Change only the `issue_comment` clause so it requires `@claude` and excludes a trimmed body equal to `@claude review`. Leave review-comment and submitted-review handling unchanged, and retain the existing model and 1,500-turn settings.

- [ ] **Step 2: Run the trigger checker**

Run `pnpm.cmd check:claude-review`. Expected: it still fails only because the specialist workflow is not present.

### Task 3: Add the official on-demand specialist workflow

**Files:**
- Create: `.github/workflows/claude-review.yml`

- [ ] **Step 1: Define the manual event and guards**

Subscribe only to `issue_comment` `created`. At job level require the event to identify a pull request, the PR state to be `open`, and `github.event.comment.body` trimmed to exactly `@claude review`.

- [ ] **Step 2: Install and invoke the maintained plugin**

Checkout full history, install marketplace `https://github.com/anthropics/claude-code.git`, enable `code-review@claude-code-plugins`, and invoke `anthropics/claude-code-action@v1` with `prompt: /code-review:code-review --comment ${{ github.repository }}/pull/${{ github.event.issue.number }}` plus `claude_args: '--allowedTools "mcp__github_inline_comment__create_inline_comment"'`. Use the existing API secret, full output, read contents/actions permissions, and write issues/pull requests permissions. Set a 30-minute timeout and PR-scoped non-canceling concurrency.

- [ ] **Step 3: Run the contract checker**

Run `pnpm.cmd check:claude-review`. Expected: PASS, including assertions that no automatic event or `review always` path exists.

### Task 4: Verify, commit, and prepare the PR

**Files:**
- Modify only the files listed above.

- [ ] **Step 1: Run focused repository checks**

Run `pnpm.cmd check:claude-review`, `pnpm.cmd format:check`, `pnpm.cmd lint:ci`, and `pnpm.cmd check:policy`. Record any environment-only failure separately; do not call a skipped check passing.

- [ ] **Step 2: Inspect the diff and trigger matrix**

Confirm exact `@claude review` starts only the specialist path; ordinary `@claude` remains generic; non-PR comments, closed PRs, edited comments, pushes, schedules, and extended commands do not start review.

- [ ] **Step 3: Commit the implementation**

Recheck `git branch --show-current`, then stage explicit paths and commit `MNE-224: route Claude review through official on-demand plugin`.

- [ ] **Step 4: Push and open the code PR**

Push the branch to origin and open a PR describing the manual trigger, official plugin prompt, and verification results. Do not merge or mark the Linear ticket Done until the workflow has been exercised once on a real PR.
