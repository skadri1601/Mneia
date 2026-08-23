export const BRANCH_RE = /^(feat|fix|docs|chore|refactor|spike|test)\/mne-\d+(-[a-z0-9]+)+$/;

export const TICKET_RE = /MNE-\d+/;

export const SUBJECT_RE = /^MNE-\d+(,\s*MNE-\d+)*:\s+\S/;

export const PR_BODY_RE = /\b(Closes|Part of)\s+MNE-\d+\b/i;

export const BRANCH_TYPES = 'feat fix docs chore refactor spike test';

// The release lane. changesets/action opens the "Version Packages" PR itself, from a branch
// whose name it owns and with a body it generates from the changesets — so it can satisfy
// none of the three rules above, and the gate failed every release on both the PR and on
// main afterwards. A gate that is red on every release cannot tell a broken release from a
// healthy one, which is the whole point of having it.
//
// Scoped as tightly as it can be: the branch name changesets uses, the exact subject the
// workflow configures, and (on a pull request) a bot author. A human cannot land here by
// naming a branch after it.
export const RELEASE_BRANCH_RE = /^changeset-release\/main$/;

export const RELEASE_SUBJECT_RE = /^release: version the client packages(\s+\(#\d+\))?$/;

export const RELEASE_AUTHOR_TYPE = 'Bot';

export function isReleaseSubject(subject) {
  return RELEASE_SUBJECT_RE.test(subject);
}

const DOCS_LANE = [
  /^[^/]+\.md$/,
  /^docs\//,
  /^\.github\/.*\.md$/,
  /^\.claude\//,
  /^(LICENSE|NOTICE|\.gitignore|\.gitattributes|\.editorconfig)$/,
];

const CODE_LANE_OVERRIDES = [/^\.claude\/settings(\.local)?\.json$/, /^\.claude\/hooks\//];

export function isDocsLane(file) {
  if (CODE_LANE_OVERRIDES.some((re) => re.test(file))) return false;
  return DOCS_LANE.some((re) => re.test(file));
}

export function classify(files) {
  const code = files.filter((f) => f && !isDocsLane(f));
  return { code, docsOnly: code.length === 0 };
}
