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
  generic,
  "github.event.comment.body != '@claude review'",
  'generic-workflow reservation exclusion',
);

forbidText(review, 'pull_request:', 'automatic pull-request trigger');
forbidText(review, 'pull_request_target:', 'privileged automatic pull-request trigger');
forbidText(review, 'push:', 'automatic push trigger');
forbidText(review, 'schedule:', 'scheduled trigger');
forbidText(review, 'review always', 'persistent review subscription');

console.log('Claude review workflow contract passed.');
