import { describe, expect, it } from 'vitest';
import {
  BRANCH_RE,
  isReleaseSubject,
  PR_BODY_RE,
  RELEASE_BRANCH_RE,
  SUBJECT_RE,
} from '../scripts/git-lanes.mjs';

// The release lane exists because changesets/action opens the "Version Packages" PR itself:
// it owns the branch name, and it generates the body from the changesets. It can satisfy
// none of the three ticket rules, so the gate failed on every single release — on the PR and
// again on main after the merge. PRs #190 and #192 both went red for exactly this.
describe('the release lane', () => {
  const subject = 'release: version the client packages';
  const squashed = 'release: version the client packages (#192)';

  it('recognises the subject changesets/action is configured to write, squashed or not', () => {
    expect(isReleaseSubject(subject)).toBe(true);
    expect(isReleaseSubject(squashed)).toBe(true);
  });

  it('recognises the branch changesets/action opens the pull request from', () => {
    expect(RELEASE_BRANCH_RE.test('changeset-release/main')).toBe(true);
  });

  it('would have failed all three ticket rules, which is why the exemption is needed', () => {
    expect(BRANCH_RE.test('changeset-release/main')).toBe(false);
    expect(SUBJECT_RE.test(subject)).toBe(false);
    expect(PR_BODY_RE.test('This PR was opened by the Changesets release GitHub action.')).toBe(
      false,
    );
  });

  it('does not exempt a subject a human could write to slip past the gate', () => {
    expect(isReleaseSubject('release: version the client packages and also refactor auth')).toBe(
      false,
    );
    expect(isReleaseSubject('chore: release: version the client packages')).toBe(false);
    expect(isReleaseSubject('release: version the packages')).toBe(false);
    expect(isReleaseSubject('  release: version the client packages')).toBe(false);
  });

  it('does not exempt a branch merely named to look like the release branch', () => {
    expect(RELEASE_BRANCH_RE.test('changeset-release/main-but-not-really')).toBe(false);
    expect(RELEASE_BRANCH_RE.test('feat/changeset-release/main')).toBe(false);
    expect(RELEASE_BRANCH_RE.test('changeset-release/some-other-base')).toBe(false);
  });

  it('still requires a ticket from ordinary work, so the gate is narrowed and not removed', () => {
    expect(isReleaseSubject('MNE-17: version the client packages')).toBe(false);
    expect(isReleaseSubject('fix: something small')).toBe(false);
    expect(SUBJECT_RE.test('MNE-17: publish the client packages')).toBe(true);
    expect(BRANCH_RE.test('fix/mne-17-release-fails-its-own-gate')).toBe(true);
  });
});
