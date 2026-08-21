import type { ItemKind } from '../store/schema.js';

export const LOAD_BEARING_SIGNALS = [
  'prohibition',
  'security_or_privacy',
  'irreversible',
  'threshold',
  'rejected_alternative',
  'model_only',
  'none',
] as const;

export type LoadBearingSignal = (typeof LOAD_BEARING_SIGNALS)[number];

export type DeterministicLoadBearingSignal = Exclude<LoadBearingSignal, 'model_only' | 'none'>;

export const LOAD_BEARING_SCAN_LIMIT = 2000;

export interface LoadBearingInput {
  readonly kind: ItemKind;
  readonly title: string;
  readonly body?: string | null | undefined;
  readonly loadBearing?: boolean | undefined;
}

export interface LoadBearingSuggestion {
  readonly suggested: boolean;
  readonly signal: LoadBearingSignal;
  readonly explanation: string;
}

interface Detector {
  readonly signal: DeterministicLoadBearingSignal;
  readonly kinds: ReadonlySet<ItemKind>;
  readonly pattern: RegExp;
}

const RULE_KINDS: ReadonlySet<ItemKind> = new Set<ItemKind>(['decision', 'constraint']);
const DECISION_ONLY: ReadonlySet<ItemKind> = new Set<ItemKind>(['decision']);

const DETECTORS: readonly Detector[] = [
  {
    signal: 'prohibition',
    kinds: RULE_KINDS,
    pattern:
      /\b(?:never|must|must not|cannot|shall not|do not|don't|prohibited|forbidden|mandatory|required|not allowed|not permitted|under no circumstances|no exceptions|only ever)\b/,
  },
  {
    signal: 'security_or_privacy',
    kinds: RULE_KINDS,
    pattern:
      /\b(?:secrets?|credentials?|passwords?|api keys?|private keys?|access tokens?|encrypt(?:ed|ion)?|pii|personal data|gdpr|hipaa|soc ?2|rls|row-?level security|tenant isolation|redact(?:ed|ion)?|permissions?|authentication|authoris(?:ation|ed)|authoriz(?:ation|ed))\b/,
  },
  {
    signal: 'irreversible',
    kinds: RULE_KINDS,
    pattern:
      /\b(?:irreversible|one-?way door|immutable|cannot be undone|breaking change|backwards? incompatible|data loss|drop table|migration|migrations|migrate)\b/,
  },
  {
    signal: 'threshold',
    kinds: RULE_KINDS,
    pattern:
      /\b(?:p\d{2}|at most|no more than|at least|maximum|minimum|under \d|below \d|within \d|\d+(?:\.\d+)? ?(?:ms|kb|mb|gb|tb|rps|qps|tokens?|seconds?|minutes?|hours?|days?)\b|\d+ ?%)/,
  },
  {
    signal: 'rejected_alternative',
    kinds: DECISION_ONLY,
    pattern:
      /\b(?:rather than|instead of|in preference to|rejected|ruled out|decided against|turned down|will not use|not adding|no need for)\b/,
  },
];

const EXPLANATIONS: Readonly<Record<LoadBearingSignal, string>> = {
  prohibition:
    'It states a prohibition or a requirement, so later work that never sees it breaks a rule somebody already set.',
  security_or_privacy:
    'It governs secrets, access, or personal data, where later work getting it wrong is not merely rework.',
  irreversible:
    'It concerns something that cannot be undone cheaply — a migration, a breaking change, or lost data.',
  threshold:
    'It fixes a numeric budget or limit that later work has to hold, and a limit nobody carries forward is a limit nobody meets.',
  rejected_alternative:
    'It records an option that was considered and rejected, and a rejected option that is forgotten is the one proposed again next week.',
  model_only:
    'The extraction marked it load-bearing but no signal in the text agrees, so this is the weaker of the two suggestions and the one most worth overriding.',
  none: 'Nothing in the text says later work is wrong without it, and the extraction did not mark it load-bearing.',
};

export function explainLoadBearingSignal(signal: LoadBearingSignal): string {
  return EXPLANATIONS[signal];
}

function scannable(input: LoadBearingInput): string {
  const body = input.body ?? '';
  return `${input.title} ${body}`.slice(0, LOAD_BEARING_SCAN_LIMIT).toLowerCase();
}

export function detectLoadBearingSignal(
  input: LoadBearingInput,
): DeterministicLoadBearingSignal | null {
  const text = scannable(input);

  for (const detector of DETECTORS) {
    if (detector.kinds.has(input.kind) && detector.pattern.test(text)) {
      return detector.signal;
    }
  }

  return null;
}

export function suggestLoadBearing(input: LoadBearingInput): LoadBearingSuggestion {
  const detected = detectLoadBearingSignal(input);

  if (detected !== null) {
    return { suggested: true, signal: detected, explanation: EXPLANATIONS[detected] };
  }

  if (input.loadBearing === true) {
    return { suggested: true, signal: 'model_only', explanation: EXPLANATIONS.model_only };
  }

  return { suggested: false, signal: 'none', explanation: EXPLANATIONS.none };
}
