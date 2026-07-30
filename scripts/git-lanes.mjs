export const BRANCH_RE = /^(feat|fix|docs|chore|refactor|spike|test)\/mne-\d+(-[a-z0-9]+)+$/;

export const TICKET_RE = /MNE-\d+/;

export const SUBJECT_RE = /^MNE-\d+(,\s*MNE-\d+)*:\s+\S/;

export const PR_BODY_RE = /\b(Closes|Part of)\s+MNE-\d+\b/i;

export const BRANCH_TYPES = 'feat fix docs chore refactor spike test';

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
