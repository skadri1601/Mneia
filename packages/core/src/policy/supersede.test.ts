import { describe, expect, it } from 'vitest';
import type { ContextItem, Uuid } from '../domain/types.js';
import type { AccessScope, ActorKind, ItemStatus } from '../store/schema.js';
import { ACCESS_SCOPES, ACTOR_KINDS, ITEM_STATUSES } from '../store/schema.js';
import type { SupersedeOutcome, SupersedeRequest } from './supersede.js';
import {
  SupersedeNotAllowedError,
  assertSupersedeAllowed,
  evaluateSupersede,
} from './supersede.js';

const WORKSPACE_ID: Uuid = '5a1d0000-0000-4000-8000-000000000001';
const PROJECT_ID: Uuid = '5a1d0000-0000-4000-8000-000000000002';
const ITEM_ID: Uuid = '5a1d0000-0000-4000-8000-000000000003';
const NEWER_ITEM_ID: Uuid = '5a1d0000-0000-4000-8000-000000000004';
const EXISTING_ACTOR: Uuid = '5a1d0000-0000-4000-8000-00000000000a';
const OTHER_ACTOR: Uuid = '5a1d0000-0000-4000-8000-00000000000b';

const ASSERTED_AT = new Date('2026-07-14T09:00:00.000Z');

interface ItemOverrides {
  readonly status?: ItemStatus;
  readonly humanConfirmed?: boolean;
  readonly loadBearing?: boolean;
  readonly supersededById?: Uuid | null;
  readonly confidence?: number;
  readonly accessScope?: AccessScope;
}

const itemWith = (overrides: ItemOverrides): ContextItem => ({
  id: ITEM_ID,
  workspaceId: WORKSPACE_ID,
  projectId: PROJECT_ID,
  kind: 'constraint',
  title: 'Idempotency keys are namespaced per merchant',
  body: null,
  status: overrides.status ?? 'active',
  assertedBy: EXISTING_ACTOR,
  assertedAt: ASSERTED_AT,
  sourceSessionId: null,
  sourceRef: null,
  confidence: overrides.confidence ?? 0.9,
  humanConfirmed: overrides.humanConfirmed ?? false,
  loadBearing: overrides.loadBearing ?? false,
  lastVerifiedAt: null,
  decayAfter: null,
  validFrom: ASSERTED_AT,
  validTo: null,
  supersedesId: null,
  supersededById: overrides.supersededById ?? null,
  accessScope: overrides.accessScope ?? 'project',
  embedding: null,
  embeddingModel: null,
});

interface Cell {
  readonly assertingActorKind: ActorKind;
  readonly humanConfirmed: boolean;
  readonly loadBearing: boolean;
  readonly sameActor: boolean;
  readonly status: ItemStatus;
}

const BOOLEANS: readonly boolean[] = [false, true];

const flag = (value: boolean): string => (value ? '1' : '0');

const keyOf = (cell: Cell): string =>
  [
    cell.assertingActorKind,
    `hc=${flag(cell.humanConfirmed)}`,
    `lb=${flag(cell.loadBearing)}`,
    `same=${flag(cell.sameActor)}`,
    cell.status,
  ].join('|');

const CASES: readonly Cell[] = ACTOR_KINDS.flatMap((assertingActorKind) =>
  BOOLEANS.flatMap((humanConfirmed) =>
    BOOLEANS.flatMap((loadBearing) =>
      BOOLEANS.flatMap((sameActor) =>
        ITEM_STATUSES.map((status) => ({
          assertingActorKind,
          humanConfirmed,
          loadBearing,
          sameActor,
          status,
        })),
      ),
    ),
  ),
);

const EXPECTED: Readonly<Record<string, SupersedeOutcome>> = {
  'human|hc=0|lb=0|same=0|active': 'allowed',
  'human|hc=0|lb=0|same=0|superseded': 'refused',
  'human|hc=0|lb=0|same=0|disputed': 'requires_human_confirmation',
  'human|hc=0|lb=0|same=0|retired': 'refused',
  'human|hc=0|lb=0|same=1|active': 'allowed',
  'human|hc=0|lb=0|same=1|superseded': 'refused',
  'human|hc=0|lb=0|same=1|disputed': 'requires_human_confirmation',
  'human|hc=0|lb=0|same=1|retired': 'refused',
  'human|hc=0|lb=1|same=0|active': 'allowed',
  'human|hc=0|lb=1|same=0|superseded': 'refused',
  'human|hc=0|lb=1|same=0|disputed': 'requires_human_confirmation',
  'human|hc=0|lb=1|same=0|retired': 'refused',
  'human|hc=0|lb=1|same=1|active': 'allowed',
  'human|hc=0|lb=1|same=1|superseded': 'refused',
  'human|hc=0|lb=1|same=1|disputed': 'requires_human_confirmation',
  'human|hc=0|lb=1|same=1|retired': 'refused',

  'human|hc=1|lb=0|same=0|active': 'requires_human_confirmation',
  'human|hc=1|lb=0|same=0|superseded': 'refused',
  'human|hc=1|lb=0|same=0|disputed': 'requires_human_confirmation',
  'human|hc=1|lb=0|same=0|retired': 'refused',
  'human|hc=1|lb=0|same=1|active': 'allowed',
  'human|hc=1|lb=0|same=1|superseded': 'refused',
  'human|hc=1|lb=0|same=1|disputed': 'requires_human_confirmation',
  'human|hc=1|lb=0|same=1|retired': 'refused',
  'human|hc=1|lb=1|same=0|active': 'requires_human_confirmation',
  'human|hc=1|lb=1|same=0|superseded': 'refused',
  'human|hc=1|lb=1|same=0|disputed': 'requires_human_confirmation',
  'human|hc=1|lb=1|same=0|retired': 'refused',
  'human|hc=1|lb=1|same=1|active': 'allowed',
  'human|hc=1|lb=1|same=1|superseded': 'refused',
  'human|hc=1|lb=1|same=1|disputed': 'requires_human_confirmation',
  'human|hc=1|lb=1|same=1|retired': 'refused',

  'agent|hc=0|lb=0|same=0|active': 'allowed',
  'agent|hc=0|lb=0|same=0|superseded': 'refused',
  'agent|hc=0|lb=0|same=0|disputed': 'requires_human_confirmation',
  'agent|hc=0|lb=0|same=0|retired': 'refused',
  'agent|hc=0|lb=0|same=1|active': 'allowed',
  'agent|hc=0|lb=0|same=1|superseded': 'refused',
  'agent|hc=0|lb=0|same=1|disputed': 'requires_human_confirmation',
  'agent|hc=0|lb=0|same=1|retired': 'refused',
  'agent|hc=0|lb=1|same=0|active': 'requires_human_confirmation',
  'agent|hc=0|lb=1|same=0|superseded': 'refused',
  'agent|hc=0|lb=1|same=0|disputed': 'requires_human_confirmation',
  'agent|hc=0|lb=1|same=0|retired': 'refused',
  'agent|hc=0|lb=1|same=1|active': 'requires_human_confirmation',
  'agent|hc=0|lb=1|same=1|superseded': 'refused',
  'agent|hc=0|lb=1|same=1|disputed': 'requires_human_confirmation',
  'agent|hc=0|lb=1|same=1|retired': 'refused',

  'agent|hc=1|lb=0|same=0|active': 'requires_human_confirmation',
  'agent|hc=1|lb=0|same=0|superseded': 'requires_human_confirmation',
  'agent|hc=1|lb=0|same=0|disputed': 'requires_human_confirmation',
  'agent|hc=1|lb=0|same=0|retired': 'requires_human_confirmation',
  'agent|hc=1|lb=0|same=1|active': 'requires_human_confirmation',
  'agent|hc=1|lb=0|same=1|superseded': 'requires_human_confirmation',
  'agent|hc=1|lb=0|same=1|disputed': 'requires_human_confirmation',
  'agent|hc=1|lb=0|same=1|retired': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=0|active': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=0|superseded': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=0|disputed': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=0|retired': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=1|active': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=1|superseded': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=1|disputed': 'requires_human_confirmation',
  'agent|hc=1|lb=1|same=1|retired': 'requires_human_confirmation',
};

function expectedFor(key: string): SupersedeOutcome {
  const outcome = EXPECTED[key];
  if (outcome === undefined) {
    throw new Error(
      `the verdict table has no row for "${key}"; every generated cell must be ruled on explicitly rather than falling through`,
    );
  }
  return outcome;
}

const requestFor = (cell: Cell): SupersedeRequest => ({
  existing: itemWith({
    status: cell.status,
    humanConfirmed: cell.humanConfirmed,
    loadBearing: cell.loadBearing,
  }),
  assertingActorKind: cell.assertingActorKind,
  assertingActorId: cell.sameActor ? EXISTING_ACTOR : OTHER_ACTOR,
});

describe('evaluateSupersede verdict table', () => {
  it('rules on every generated cell exactly once, with no spare rows', () => {
    const generated = CASES.map(keyOf);

    expect(generated).toHaveLength(64);
    expect(new Set(generated).size).toBe(64);
    expect(Object.keys(EXPECTED).sort()).toEqual([...generated].sort());
  });

  for (const cell of CASES) {
    const key = keyOf(cell);

    it(`${key} -> ${expectedFor(key)}`, () => {
      expect(evaluateSupersede(requestFor(cell)).outcome).toBe(expectedFor(key));
    });
  }
});

describe('verdict reasons', () => {
  it('names the item and ends in a full stop on every blocked cell', () => {
    for (const cell of CASES) {
      const verdict = evaluateSupersede(requestFor(cell));

      if (verdict.outcome === 'allowed') {
        continue;
      }

      expect(verdict.reason).toContain(ITEM_ID);
      expect(verdict.reason.length).toBeGreaterThan(80);
      expect(verdict.reason.endsWith('.')).toBe(true);
    }
  });

  it('cites the arbitration rule on every cell that needs human confirmation', () => {
    for (const cell of CASES) {
      const verdict = evaluateSupersede(requestFor(cell));

      if (verdict.outcome !== 'requires_human_confirmation') {
        continue;
      }

      expect(verdict.reason).toMatch(/vision\.md §10\.(1|4)/);
    }
  });

  it('explains the agent-over-human-confirmed refusal in terms a user can act on', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ humanConfirmed: true }),
      assertingActorKind: 'agent',
      assertingActorId: OTHER_ACTOR,
    });

    expect(verdict.outcome).toBe('requires_human_confirmation');
    if (verdict.outcome === 'allowed') {
      throw new Error('standing rule 1 was violated');
    }
    expect(verdict.reason).toContain('human_confirmed');
    expect(verdict.reason).toContain('pending queue');
    expect(verdict.reason).toContain('disputed');
    expect(verdict.reason).toContain('§10.1 step 5');
  });

  it('explains the human-versus-human case as a conflict to record, not an overwrite', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ humanConfirmed: true }),
      assertingActorKind: 'human',
      assertingActorId: OTHER_ACTOR,
    });

    expect(verdict.outcome).toBe('requires_human_confirmation');
    if (verdict.outcome === 'allowed') {
      throw new Error('standing rule 3 was violated');
    }
    expect(verdict.reason).toContain('conflict row');
    expect(verdict.reason).toContain('both actors');
    expect(verdict.reason).toContain(EXISTING_ACTOR);
    expect(verdict.reason).toContain('§10.4');
  });
});

describe('the load-bearing gate and the asserter confirmation flag', () => {
  it('blocks an agent superseding a load-bearing item that carries no human confirmation', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ loadBearing: true }),
      assertingActorKind: 'agent',
      assertingActorId: OTHER_ACTOR,
      humanConfirmedByAsserter: false,
    });

    expect(verdict.outcome).toBe('requires_human_confirmation');
  });

  it('lets a confirmed agent supersede clear the load-bearing gate, which is how the pending queue drains', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ loadBearing: true }),
      assertingActorKind: 'agent',
      assertingActorId: OTHER_ACTOR,
      humanConfirmedByAsserter: true,
    });

    expect(verdict.outcome).toBe('allowed');
  });

  it('never lets the flag lift standing rule 1', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ humanConfirmed: true, loadBearing: true }),
      assertingActorKind: 'agent',
      assertingActorId: OTHER_ACTOR,
      humanConfirmedByAsserter: true,
    });

    expect(verdict.outcome).toBe('requires_human_confirmation');
  });

  it('never lets the flag auto-resolve a human-versus-human conflict', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ humanConfirmed: true }),
      assertingActorKind: 'human',
      assertingActorId: OTHER_ACTOR,
      humanConfirmedByAsserter: true,
    });

    expect(verdict.outcome).toBe('requires_human_confirmation');
  });

  it('never lets the flag supersede a disputed item behind the conflict record', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ status: 'disputed' }),
      assertingActorKind: 'human',
      assertingActorId: EXISTING_ACTOR,
      humanConfirmedByAsserter: true,
    });

    expect(verdict.outcome).toBe('requires_human_confirmation');
  });

  it('lets a human supersede their own human-confirmed item without ceremony', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ humanConfirmed: true, loadBearing: true }),
      assertingActorKind: 'human',
      assertingActorId: EXISTING_ACTOR,
    });

    expect(verdict.outcome).toBe('allowed');
  });
});

describe('chain integrity', () => {
  it('refuses a supersede aimed at a row that already points to a newer revision', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({ status: 'active', supersededById: NEWER_ITEM_ID }),
      assertingActorKind: 'human',
      assertingActorId: EXISTING_ACTOR,
    });

    expect(verdict.outcome).toBe('refused');
    if (verdict.outcome === 'allowed') {
      throw new Error('a superseded row was treated as the head of its chain');
    }
    expect(verdict.reason).toContain(NEWER_ITEM_ID);
    expect(verdict.reason).toContain('current head');
  });

  it('checks standing rule 1 before chain integrity, so the agent case is always reviewable', () => {
    const verdict = evaluateSupersede({
      existing: itemWith({
        humanConfirmed: true,
        status: 'superseded',
        supersededById: NEWER_ITEM_ID,
      }),
      assertingActorKind: 'agent',
      assertingActorId: OTHER_ACTOR,
    });

    expect(verdict.outcome).toBe('requires_human_confirmation');
  });
});

interface FlagVariant {
  readonly label: string;
  readonly apply: (base: SupersedeRequest) => SupersedeRequest;
}

const FLAG_VARIANTS: readonly FlagVariant[] = [
  { label: 'flag=absent', apply: (base) => base },
  { label: 'flag=false', apply: (base) => ({ ...base, humanConfirmedByAsserter: false }) },
  { label: 'flag=true', apply: (base) => ({ ...base, humanConfirmedByAsserter: true }) },
];

const CONFIDENCES: readonly number[] = [0, 0.5, 1];
const SUPERSEDED_BY: readonly (Uuid | null)[] = [null, NEWER_ITEM_ID];

describe('GUARD (MNE-63) standing rule 1: an agent assertion never auto-supersedes a human-confirmed item', () => {
  it('yields no allowed verdict anywhere in the generated input space, and this test is never weakened, skipped, or deleted', () => {
    const labels: string[] = [];
    const escapes: string[] = [];
    const notQueued: string[] = [];

    for (const status of ITEM_STATUSES) {
      for (const loadBearing of BOOLEANS) {
        for (const sameActor of BOOLEANS) {
          for (const supersededById of SUPERSEDED_BY) {
            for (const confidence of CONFIDENCES) {
              for (const accessScope of ACCESS_SCOPES) {
                for (const variant of FLAG_VARIANTS) {
                  const request = variant.apply({
                    existing: itemWith({
                      status,
                      humanConfirmed: true,
                      loadBearing,
                      supersededById,
                      confidence,
                      accessScope,
                    }),
                    assertingActorKind: 'agent',
                    assertingActorId: sameActor ? EXISTING_ACTOR : OTHER_ACTOR,
                  });

                  const label = [
                    status,
                    `lb=${flag(loadBearing)}`,
                    `same=${flag(sameActor)}`,
                    `superseded_by=${supersededById === null ? 'null' : 'set'}`,
                    `confidence=${confidence}`,
                    accessScope,
                    variant.label,
                  ].join('|');

                  const verdict = evaluateSupersede(request);

                  labels.push(label);
                  if (verdict.outcome === 'allowed') {
                    escapes.push(label);
                  } else if (verdict.outcome !== 'requires_human_confirmation') {
                    notQueued.push(label);
                  }
                }
              }
            }
          }
        }
      }
    }

    expect(labels).toHaveLength(1440);
    expect(escapes).toEqual([]);
    expect(notQueued).toEqual([]);
  });

  it('throws rather than returning, for every one of those inputs, when a caller asserts the supersede', () => {
    const applied: string[] = [];

    for (const status of ITEM_STATUSES) {
      for (const loadBearing of BOOLEANS) {
        for (const variant of FLAG_VARIANTS) {
          const request = variant.apply({
            existing: itemWith({ status, humanConfirmed: true, loadBearing }),
            assertingActorKind: 'agent',
            assertingActorId: OTHER_ACTOR,
          });

          try {
            assertSupersedeAllowed(request);
            applied.push(`${status}|lb=${flag(loadBearing)}|${variant.label}`);
          } catch (error) {
            expect(error).toBeInstanceOf(SupersedeNotAllowedError);
          }
        }
      }
    }

    expect(applied).toEqual([]);
  });
});

describe('assertSupersedeAllowed', () => {
  it('returns quietly when the verdict is allowed', () => {
    expect(() =>
      assertSupersedeAllowed({
        existing: itemWith({}),
        assertingActorKind: 'agent',
        assertingActorId: OTHER_ACTOR,
      }),
    ).not.toThrow();
  });

  it('throws a named error carrying the outcome, the reason, and the item', () => {
    let caught: unknown;

    try {
      assertSupersedeAllowed({
        existing: itemWith({ humanConfirmed: true }),
        assertingActorKind: 'agent',
        assertingActorId: OTHER_ACTOR,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SupersedeNotAllowedError);
    if (!(caught instanceof SupersedeNotAllowedError)) {
      throw new Error('expected a SupersedeNotAllowedError, but the supersede was allowed');
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught.name).toBe('SupersedeNotAllowedError');
    expect(caught.outcome).toBe('requires_human_confirmation');
    expect(caught.itemId).toBe(ITEM_ID);
    expect(caught.message).toBe(caught.reason);
    expect(caught.reason).toContain('§10.1 step 5');
  });

  it('throws on a refusal as well as on a pending confirmation', () => {
    let caught: unknown;

    try {
      assertSupersedeAllowed({
        existing: itemWith({ status: 'retired' }),
        assertingActorKind: 'human',
        assertingActorId: EXISTING_ACTOR,
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SupersedeNotAllowedError);
    if (!(caught instanceof SupersedeNotAllowedError)) {
      throw new Error('expected a SupersedeNotAllowedError, but the supersede was allowed');
    }
    expect(caught.outcome).toBe('refused');
    expect(caught.reason).toContain('retired');
  });
});
