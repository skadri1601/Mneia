import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const generic = await readFile(resolve(root, '.github/workflows/claude.yml'), 'utf8');
const review = await readFile(resolve(root, '.github/workflows/claude-review.yml'), 'utf8');

function requireText(source, text, description) {
  if (!source.includes(text)) {
    throw new Error(`Claude review workflow contract missing: ${description}`);
  }
}

function forbidText(source, text, description) {
  if (source.includes(text)) {
    throw new Error(`Claude review workflow contract violated: ${description}`);
  }
}

requireText(review, 'types: [created]', 'created issue-comment event');
requireText(review, 'github.event.issue.pull_request', 'pull-request guard');
requireText(review, "github.event.issue.state == 'open'", 'open-pull-request guard');
requireText(review, "github.event.comment.body == '@claude review'", 'exact manual command guard');
requireText(review, 'plugin_marketplaces:', 'Anthropic plugin marketplace installation');
requireText(review, 'plugins:', 'Anthropic code-review plugin installation');
requireText(review, 'code-review@claude-code-plugins', 'official code-review plugin');
requireText(
  review,
  '/code-review:code-review --comment ${{ github.repository }}/pull/${{ github.event.issue.number }}',
  'official review prompt',
);
requireText(
  review,
  'mcp__github_inline_comment__create_inline_comment',
  'inline-comment tool permission',
);
requireText(
  review,
  'Bash(gh pr view *),Bash(gh pr diff *),Bash(gh pr list *),Bash(gh pr comment *),Bash(gh issue view *),Bash(gh issue list *),Bash(gh search *),Bash(gh api *),Bash(git diff *),Bash(git log *),Bash(git show *),Bash(git blame *),Bash(git status *)',
  'read-only plugin command permissions',
);
requireText(
  generic,
  "!startsWith(github.event.comment.body, '@claude review')",
  'generic-workflow reservation exclusion',
);

forbidText(review, 'pull_request:', 'automatic pull-request trigger');
forbidText(review, 'pull_request_target:', 'privileged automatic pull-request trigger');
forbidText(review, 'push:', 'automatic push trigger');
forbidText(review, 'schedule:', 'scheduled trigger');
forbidText(review, 'show_full_output: true', 'unredacted workflow output');

const specialistReview = ({ isPullRequest, state, body }) =>
  isPullRequest && state === 'open' && body === '@claude review';
const genericReview = ({ eventName, body }) =>
  eventName === 'issue_comment' && body.includes('@claude') && !body.startsWith('@claude review');

const specialistCases = [
  [{ isPullRequest: true, state: 'open', body: '@claude review' }, true],
  [{ isPullRequest: true, state: 'open', body: '  @claude review  ' }, false],
  [{ isPullRequest: true, state: 'open', body: '@claude review always' }, false],
  [{ isPullRequest: false, state: 'open', body: '@claude review' }, false],
  [{ isPullRequest: true, state: 'closed', body: '@claude review' }, false],
];
for (const [input, expected] of specialistCases) {
  if (specialistReview(input) !== expected) {
    throw new Error(`Claude specialist trigger matrix failed for ${JSON.stringify(input)}`);
  }
}
const genericCases = [
  [{ eventName: 'issue_comment', body: '@claude explain this failure' }, true],
  [{ eventName: 'issue_comment', body: '@claude review always' }, false],
  [{ eventName: 'issue_comment', body: '  @claude review  ' }, true],
  [{ eventName: 'issue_comment', body: 'Please @claude review this' }, true],
  [{ eventName: 'pull_request_review_comment', body: '@claude explain this line' }, false],
];
for (const [input, expected] of genericCases) {
  if (genericReview(input) !== expected) {
    throw new Error(`Claude generic trigger matrix failed for ${JSON.stringify(input)}`);
  }
}

console.log('Claude review workflow contract passed.');
