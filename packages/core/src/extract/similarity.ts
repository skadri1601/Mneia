export type Stance = 'affirm' | 'negate';

const SUBJECT_STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'been',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'has',
  'have',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'our',
  'over',
  'per',
  'shall',
  'should',
  'so',
  'that',
  'the',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'until',
  'up',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'which',
  'will',
  'with',
  'would',
]);

const NEGATION_MARKERS: readonly string[] = [
  'avoid',
  'avoided',
  'avoids',
  'ban',
  'banned',
  'bans',
  'cannot',
  'cant',
  'deprecate',
  'deprecated',
  'deprecates',
  'disable',
  'disabled',
  'disables',
  'disallow',
  'disallowed',
  'disallows',
  'drop',
  'dropped',
  'drops',
  'exclude',
  'excluded',
  'excludes',
  'forbid',
  'forbidden',
  'forbids',
  'never',
  'no',
  'none',
  'nor',
  'not',
  'prohibit',
  'prohibited',
  'prohibits',
  'refuse',
  'refused',
  'refuses',
  'reject',
  'rejected',
  'rejects',
  'remove',
  'removed',
  'removes',
  'revoke',
  'revoked',
  'revokes',
  'stop',
  'stopped',
  'stops',
  'without',
];

const NEGATION_SET: ReadonlySet<string> = new Set(NEGATION_MARKERS);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(normalized: string): ReadonlySet<string> {
  return new Set(normalized.split(' ').filter((token) => token.length > 0));
}

export function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }

  return shared / (left.size + right.size - shared);
}

const startsWithDigit = (token: string): boolean => /^\d/.test(token);

export function subjectTokens(text: string): ReadonlySet<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(normalizeText(text))) {
    if (SUBJECT_STOPWORDS.has(token) || NEGATION_SET.has(token) || startsWithDigit(token)) {
      continue;
    }
    tokens.add(token);
  }
  return tokens;
}

export function sharedTokens(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): readonly string[] {
  const shared: string[] = [];
  for (const token of left) {
    if (right.has(token)) {
      shared.push(token);
    }
  }
  return shared.sort();
}

export function stanceOf(text: string): Stance {
  const tokens = tokenize(normalizeText(text));
  for (const marker of NEGATION_MARKERS) {
    if (tokens.has(marker)) {
      return 'negate';
    }
  }
  return 'affirm';
}

export function stanceMarkersIn(text: string): readonly string[] {
  const tokens = tokenize(normalizeText(text));
  return NEGATION_MARKERS.filter((marker) => tokens.has(marker));
}

export function numericLiterals(text: string): readonly string[] {
  const matches = text.toLowerCase().match(/\d+(?:\.\d+)?/g);
  return matches === null ? [] : [...new Set(matches)].sort();
}

export function sameNumbers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
