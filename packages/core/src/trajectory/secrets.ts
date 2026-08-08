export const SECRET_PLACEHOLDER = '[redacted:%s]';

export interface SecretPattern {
  readonly label: string;
  readonly pattern: RegExp;
  readonly group: number;
}

const SECRET_KEY_SUFFIX =
  '(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_?KEY|APIKEY|ACCESS_?KEY|SECRET_?KEY|PRIVATE_?KEY|CLIENT_?SECRET|CREDENTIAL|CREDENTIALS|DSN)';

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    label: 'private-key',
    pattern:
      /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g,
    group: 0,
  },
  { label: 'anthropic-key', pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}/g, group: 0 },
  { label: 'openai-key', pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, group: 0 },
  { label: 'github-token', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, group: 0 },
  { label: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, group: 0 },
  { label: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, group: 0 },
  { label: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, group: 0 },
  { label: 'google-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, group: 0 },
  { label: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, group: 0 },
  {
    label: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    group: 0,
  },
  {
    label: 'bearer-token',
    pattern: /\b(?:Bearer|Basic)\s+([A-Za-z0-9._~+/=-]{16,})/gi,
    group: 1,
  },
  {
    label: 'url-credentials',
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:([^\s/@]{3,})@/gi,
    group: 1,
  },
  {
    label: 'env-assignment',
    pattern: new RegExp(
      `(?:^|[\\s"'\`(])[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_?${SECRET_KEY_SUFFIX}\\s*=\\s*["']?([^\\s"'\`,;]{6,})`,
      'gm',
    ),
    group: 1,
  },
];

export interface Redacted {
  readonly text: string;
  readonly redactions: readonly string[];
}

const placeholderFor = (label: string): string => SECRET_PLACEHOLDER.replace('%s', label);

export function redactSecrets(text: string): Redacted {
  if (text.length === 0) {
    return { text, redactions: [] };
  }

  const redactions: string[] = [];
  let result = text;

  for (const { label, pattern, group } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, (match, ...captures) => {
      const captured = group === 0 ? match : (captures[group - 1] as string | undefined);
      if (captured === undefined || captured.length === 0) {
        return match;
      }
      if (placeholderFor(label) === captured) {
        return match;
      }
      redactions.push(label);
      return group === 0 ? placeholderFor(label) : match.replace(captured, placeholderFor(label));
    });
  }

  return { text: result, redactions };
}
