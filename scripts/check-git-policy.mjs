#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  BRANCH_RE,
  BRANCH_TYPES,
  classify,
  isReleaseSubject,
  PR_BODY_RE,
  RELEASE_AUTHOR_TYPE,
  RELEASE_BRANCH_RE,
  SUBJECT_RE,
  TICKET_RE,
} from './git-lanes.mjs';

const SQUASHED_PR_RE = /\(#\d+\)$/;

const failures = [];

function fail(what, detail) {
  failures.push({ what, detail });
}

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function subjects(range) {
  const raw = git(['log', '--no-merges', '--format=%s', range]);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function changedFiles(range) {
  const raw = git(['diff', '--name-only', range]);
  return raw ? raw.split('\n').filter(Boolean) : [];
}

function readEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function checkSubjects(list) {
  for (const subject of list) {
    if (isReleaseSubject(subject)) continue;
    if (!TICKET_RE.test(subject)) {
      fail(
        `commit subject has no MNE-nnn reference: "${subject}"`,
        'Linear links work by ticket id, and AGENTS.md says work not in a ticket did not happen.\n' +
          '  Expected: MNE-<n>: <imperative summary>',
      );
    } else if (!SUBJECT_RE.test(subject)) {
      fail(
        `commit subject is not in the required form: "${subject}"`,
        'Expected: MNE-<n>: <imperative summary>\n' +
          '  Several tickets: MNE-<n>, MNE-<m>: <summary>',
      );
    }
  }
}

function checkPullRequest(event) {
  const branch = event?.pull_request?.head?.ref ?? process.env.GITHUB_HEAD_REF ?? '';
  const base = event?.pull_request?.base?.ref ?? process.env.GITHUB_BASE_REF ?? 'main';
  const body = event?.pull_request?.body ?? '';
  const authorType = event?.pull_request?.user?.type ?? '';

  if (RELEASE_BRANCH_RE.test(branch) && authorType === RELEASE_AUTHOR_TYPE) {
    process.stdout.write('git policy: release pull request, opened by a bot — exempt\n');
    return { branch, range: '' };
  }

  if (!BRANCH_RE.test(branch)) {
    fail(
      `branch "${branch}" does not match the naming convention`,
      `Required: <type>/mne-<n>-<slug>\n  Types:    ${BRANCH_TYPES}\n` +
        '  Example:  feat/mne-42-context-item-schema\n' +
        '  The mne-<n> segment is what makes Linear auto-link the branch and PR.',
    );
  }

  if (!PR_BODY_RE.test(body)) {
    fail(
      'PR body does not reference a ticket',
      'Add "Closes MNE-<n>" or "Part of MNE-<n>" so Linear closes or links the ticket on merge.',
    );
  }

  const range = `origin/${base}...HEAD`;
  checkSubjects(subjects(range));

  return { branch, range };
}

function checkPushToMain(event) {
  const before = event?.before ?? '';
  const after = event?.after ?? 'HEAD';

  const headIsMerge = git(['rev-list', '--merges', '-n', '1', `${after}^..${after}`]);
  if (headIsMerge) return null;

  const range = before && !/^0+$/.test(before) ? `${before}..${after}` : '';
  if (!range) return null;

  const list = subjects(range);
  if (list.length === 0) return null;

  checkSubjects(list);

  if (list.some((subject) => SQUASHED_PR_RE.test(subject))) {
    return { range };
  }

  const { code, docsOnly } = classify(changedFiles(range));
  if (!docsOnly) {
    fail(
      'code-lane files reached main without a pull request',
      `Code-lane files in ${range}:\n${code.map((f) => `    - ${f}`).join('\n')}\n` +
        '  CLAUDE.md > Git lanes: docs commit direct to main, code goes through a reviewed PR.',
    );
  }

  return { range };
}

function checkLocal() {
  git(['fetch', 'origin', '--quiet']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!git(['rev-parse', '--verify', '--quiet', 'origin/main'])) {
    process.stdout.write('git policy: no origin/main to compare against, skipping\n');
    process.exit(0);
  }

  const range = 'origin/main...HEAD';
  if (branch !== 'main' && !BRANCH_RE.test(branch)) {
    fail(
      `branch "${branch}" does not match the naming convention`,
      `Required: <type>/mne-<n>-<slug>\n  Types:    ${BRANCH_TYPES}`,
    );
  }
  checkSubjects(subjects(range));
  return { branch, range };
}

const event = readEvent();
const eventName = process.env.GITHUB_EVENT_NAME ?? 'local';

let context = null;
if (eventName === 'pull_request' || eventName === 'pull_request_target') {
  context = checkPullRequest(event);
} else if (eventName === 'push') {
  context = checkPushToMain(event);
} else {
  context = checkLocal();
}

if (context === null) {
  process.stdout.write('git policy: nothing to check for this event\n');
  process.exit(0);
}

if (failures.length === 0) {
  process.stdout.write(`git policy: clean (${eventName})\n`);
  process.exit(0);
}

process.stderr.write(`Git policy violations (${failures.length}):\n\n`);
for (const { what, detail } of failures) {
  process.stderr.write(`  ${what}\n  ${detail}\n\n`);
}
process.exit(1);
