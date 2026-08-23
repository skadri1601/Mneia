# On-demand Claude PR review design

**Ticket:** MNE-224  
**Date:** 2026-08-23  
**Status:** Ready for founder review

## Outcome

A maintainer can request one high-signal Claude review by posting the exact top-level pull-request comment `@claude review`. That comment runs Anthropic's official multi-agent review plugin once, posts validated inline findings or a no-issues summary, and does not subscribe the PR to future reviews.

Opening a pull request, pushing another commit, scheduling a workflow, or writing `@claude review always` never starts or persists a review. Existing non-review `@claude` requests keep their current generic Claude Code behavior.

## Why this path

The current workflow sends every `@claude` mention to one generic interactive agent. Raising `--max-turns` to 1,500 only increases how long that agent may run; it does not add the independent bug, security, repository-rule, and confidence-verification passes that make a review trustworthy.

Anthropic's official `code-review@claude-code-plugins` plugin already supplies that review architecture. Its review command launches parallel specialist agents, verifies candidate findings independently, filters low-confidence findings, ignores style-only and pre-existing issues, and supports GitHub inline comments through `--comment`. Reusing it keeps the workflow aligned with Anthropic's maintained guidance instead of copying that orchestration into a repository-owned prompt.

## Trigger routing

The review path listens only to `issue_comment.created` and runs only when all of these are true:

- the comment belongs to a pull request;
- the pull request is open;
- the trimmed comment body is exactly `@claude review`.

The existing generic workflow keeps its current issue-comment, review-comment, and submitted-review events, but its top-level issue-comment condition excludes that exact reserved command. This guarantees one comment starts at most one Claude job while preserving other uses such as `@claude explain this failure`.

No `pull_request`, `pull_request_target`, `push`, `schedule`, or persistent-label trigger is added. Extra words do not match the reserved command, so `@claude review always` cannot create an automatic mode.

## Anthropic plugin invocation

The review job checks out full history, installs Anthropic's official Claude Code plugin marketplace and `code-review@claude-code-plugins`, then gives `anthropics/claude-code-action@v1` this fixed automation prompt:

```text
/code-review:code-review ${{ github.repository }}/pull/${{ github.event.issue.number }} --comment
```

Using a fixed `prompt` puts this job in automation mode. The plugin owns its documented specialist-model mix, parallel review stages, confidence threshold, and comment formatting. The repository does not replace those internals with a large custom prose prompt.

The repository's review constraints remain available through `CLAUDE.md`, which imports `AGENTS.md`. Those rules cover human-confirmed assertions, load-bearing constraints, write events, revoked privacy promises, published legal text, RLS, the 300ms rehydrate budget, ticket acceptance, and Section 19 scope.

## Workflow shape and limits

The specialist review lives in a separate `.github/workflows/claude-review.yml`. Separating it from the generic assistant path makes the manual trigger and fixed prompt auditable. `.github/workflows/claude.yml` changes only enough to exclude the reserved command.

The review workflow keeps least-privilege repository access: read contents and Actions results, plus write issues and pull requests for progress, summaries, and inline findings. It uses the existing `ANTHROPIC_API_KEY`; Claude Max does not fund GitHub Action API usage.

The current `claude-sonnet-5` and `--max-turns 1500` settings remain on the generic workflow. The specialist workflow does not force that model because the official plugin selects the documented mix of review and verification models. Its timeout is 30 minutes so the plugin's parallel passes can complete without turning the turn ceiling into the controlling failure mode.

Concurrency is scoped to the pull request and does not cancel a running review. A second exact manual request may run after the first; it is another explicit request, not an automatic subscription.

## Failure behavior

- A non-PR issue comment cannot start the review job.
- A closed pull request cannot start the review job.
- An edited comment cannot start a review because only `created` is subscribed.
- A malformed or extended command does not fall through to specialist review.
- The reserved exact command is excluded from generic handling, so plugin setup failure cannot produce a second generic review.
- Action or plugin startup failures remain visible through full workflow output; no token or user content is printed deliberately.

## Verification

Static verification checks YAML parsing, repository formatting, lint, and git policy. Trigger-condition tests or an equivalent local expression harness cover exact review, surrounding whitespace, ordinary `@claude` requests, non-PR issues, closed PRs, and `@claude review always`.

Acceptance is completed on the implementation pull request:

1. Opening and pushing the PR produces no Claude review.
2. An ordinary non-review `@claude` comment reaches only the generic workflow.
3. A top-level `@claude review` comment starts exactly one specialist workflow.
4. The run installs the official plugin and posts inline findings or its no-issues summary.
5. A later push produces no additional Claude review.

The ticket remains In Progress until that real-PR exercise succeeds and the output is worth reading.

## Official references

- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [Anthropic code-review plugin](https://github.com/anthropics/claude-code/tree/main/plugins/code-review)
- [Official `/code-review` command](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md)
