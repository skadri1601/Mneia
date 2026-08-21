import type { ItemKind } from '../../store/schema.js';
import type { ExistingItemSnapshot, ReconcileVerdict } from '../reconcile.js';
import type { ExtractionCandidate } from '../schema.js';

export type EvalFamily =
  | 'decision_reversed'
  | 'constraint_loosened'
  | 'value_changed'
  | 'refinement'
  | 'different_subject'
  | 'reported_not_asserted'
  | 'unchanged';

export interface EvalCase {
  readonly id: string;
  readonly family: EvalFamily;
  readonly candidate: ExtractionCandidate;
  readonly existing: readonly ExistingItemSnapshot[];
  readonly expected: ReconcileVerdict;
  readonly why: string;
}

interface Draft {
  readonly kind: ItemKind;
  readonly title: string;
  readonly body?: string;
}

const asCandidate = (draft: Draft): ExtractionCandidate => ({
  kind: draft.kind,
  title: draft.title,
  body: draft.body ?? null,
  rationale: null,
  confidence: 0.8,
  loadBearing: false,
  accessScope: 'project',
  sourceRef: null,
});

const asExisting = (id: string, draft: Draft): ExistingItemSnapshot => ({
  id,
  kind: draft.kind,
  title: draft.title,
  body: draft.body ?? null,
});

interface CaseInput {
  readonly id: string;
  readonly family: EvalFamily;
  readonly recorded: Draft;
  readonly proposed: Draft;
  readonly expected: ReconcileVerdict;
  readonly why: string;
  readonly distractors?: readonly Draft[];
}

function build(input: CaseInput): EvalCase {
  const distractors = input.distractors ?? [];
  return {
    id: input.id,
    family: input.family,
    candidate: asCandidate(input.proposed),
    existing: [
      asExisting(`${input.id}-recorded`, input.recorded),
      ...distractors.map((draft, offset) => asExisting(`${input.id}-other-${offset}`, draft)),
    ],
    expected: input.expected,
    why: input.why,
  };
}

export const CONTRADICTION_EVAL_CASES: readonly EvalCase[] = [
  build({
    id: 'locality-promise-revoked',
    family: 'decision_reversed',
    recorded: { kind: 'constraint', title: 'Never send item content off the machine' },
    proposed: {
      kind: 'constraint',
      title: 'Send item content off the machine to the hosted extraction service',
    },
    expected: 'contradiction',
    why: 'The §11.1 locality promise was revoked on 2026-07-28 when the product became hosted-only. The recorded prohibition and the proposal cannot both hold.',
  }),
  build({
    id: 'rule-1-auto-supersede-permitted',
    family: 'constraint_loosened',
    recorded: {
      kind: 'constraint',
      title: 'Never auto-supersede a human-confirmed item with an agent assertion',
    },
    proposed: {
      kind: 'constraint',
      title: 'Auto-supersede a human-confirmed item when the agent confidence is above 0.9',
    },
    expected: 'contradiction',
    why: 'Standing rule 1, §10.1. A confidence carve-out is the exact loosening the rule forbids, so it has to reach a human rather than be recorded quietly.',
  }),
  build({
    id: 'rehydrate-budget-raised',
    family: 'value_changed',
    recorded: { kind: 'constraint', title: 'Rehydrate p95 stays under 300ms' },
    proposed: { kind: 'constraint', title: 'Rehydrate p95 stays under 500ms' },
    expected: 'contradiction',
    why: 'Same subject, same stance, different bound. §12.1 fixes the budget at 300ms, so raising it is a decision a human makes.',
  }),
  build({
    id: 'individual-tier-charged',
    family: 'constraint_loosened',
    recorded: { kind: 'constraint', title: 'Do not charge for the individual tier' },
    proposed: { kind: 'constraint', title: 'Charge nine dollars a month for the individual tier' },
    expected: 'contradiction',
    why: 'Standing rule 7, §14. The subject is the same tier and the stance is flipped.',
  }),
  build({
    id: 'npm-publishing-automated',
    family: 'decision_reversed',
    recorded: { kind: 'decision', title: 'Publish the client packages to npm manually' },
    proposed: {
      kind: 'decision',
      title: 'Publish the client packages to npm automatically when a version PR merges',
    },
    expected: 'contradiction',
    why: 'MNE-17 reversed the manual-only rule on 2026-08-17. The reversal carries no negation and no number: manually against automatically is an antonym pair, which is what a lexical classifier cannot see.',
  }),
  build({
    id: 'worktree-creation-permitted',
    family: 'decision_reversed',
    recorded: { kind: 'constraint', title: 'Never create a new git worktree' },
    proposed: { kind: 'constraint', title: 'Create a new git worktree for each task' },
    expected: 'contradiction',
    why: 'The worktree guard exists because twenty stale trees were expensive to remove. Permitting a tree per task reverses that ruling outright.',
  }),
  build({
    id: 'schema-version-moved',
    family: 'value_changed',
    recorded: { kind: 'fact', title: 'The store schema is at version 32' },
    proposed: { kind: 'fact', title: 'The store schema is at version 34' },
    expected: 'contradiction',
    why: 'Two versions of the same fact. One of them is stale, and which one holds is not an agent decision.',
  }),
  build({
    id: 'store-engine-swapped',
    family: 'decision_reversed',
    recorded: { kind: 'decision', title: 'Use Neon Postgres as the hosted store' },
    proposed: { kind: 'decision', title: 'Use Supabase Postgres as the hosted store' },
    expected: 'contradiction',
    why: 'Two mutually exclusive choices for one slot. Nothing lexical marks them as exclusive; one vendor token differs and it reads as ordinary vocabulary drift.',
  }),
  build({
    id: 'telemetry-content-permitted-with-new-body',
    family: 'constraint_loosened',
    recorded: {
      kind: 'constraint',
      title: 'Never put item content in a telemetry event',
      body: 'Redaction strips body text before the event is emitted.',
    },
    proposed: {
      kind: 'constraint',
      title: 'Put item content in a telemetry event for debugging',
      body: 'The redaction step hides the field we need when an extraction goes wrong.',
    },
    expected: 'contradiction',
    why: 'Standing rule 6 and MNE-50. A real reversal almost always arrives with its own reasoning attached, so a differing body must not be allowed to hide the flipped stance.',
  }),
  build({
    id: 'waitlist-retention-extended',
    family: 'value_changed',
    recorded: {
      kind: 'constraint',
      title: 'Waitlist addresses are deleted within 30 days of access opening',
    },
    proposed: {
      kind: 'constraint',
      title: 'Waitlist addresses are deleted within 180 days of access opening',
    },
    expected: 'contradiction',
    why: 'The 30-day clause is published in the privacy policy. Extending it silently would put the product out of step with a live promise.',
  }),
  build({
    id: 'migration-permission-delegated',
    family: 'decision_reversed',
    recorded: {
      kind: 'decision',
      title: 'Agents ask the founder before applying a pending migration to production',
    },
    proposed: {
      kind: 'decision',
      title: 'Agents apply a pending migration to production without asking the founder',
    },
    expected: 'contradiction',
    why: 'The 2026-08-19 ruling delegated migrations. Both statements are about the same permission and only one can be current.',
  }),
  build({
    id: 'rls-posture-flipped',
    family: 'decision_reversed',
    recorded: { kind: 'fact', title: 'Row level security is enforced on every tenant table' },
    proposed: { kind: 'fact', title: 'Row level security is bypassed on every tenant table' },
    expected: 'contradiction',
    why: 'enforced against bypassed is the whole claim, and neither word is a negation marker, so the two read as near-identical text saying opposite things.',
  }),
  build({
    id: 'nearest-match-across-a-crowded-store',
    family: 'value_changed',
    recorded: { kind: 'constraint', title: 'The handoff token budget is 3000 tokens' },
    proposed: { kind: 'constraint', title: 'The handoff token budget is 5000 tokens' },
    distractors: [
      { kind: 'constraint', title: 'Rehydrate p95 stays under 300ms' },
      { kind: 'constraint', title: 'Never log user content' },
      { kind: 'decision', title: 'The handoff token budget is 9000 tokens' },
    ],
    expected: 'contradiction',
    why: 'The conflicting item has to be found among unrelated constraints and a same-text item of another kind. Picking the wrong neighbour would produce a plausible but wrong reason.',
  }),
  build({
    id: 'worktree-guard-restates-the-prohibition',
    family: 'reported_not_asserted',
    recorded: { kind: 'constraint', title: 'Never create a new git worktree' },
    proposed: {
      kind: 'constraint',
      title: 'The worktree guard hook refuses any attempt to create a new git worktree',
    },
    expected: 'novel',
    why: 'This agrees with the recorded prohibition and adds how it is enforced. It reads as an affirmative sentence only because the negation sits in an inflected verb.',
  }),
  build({
    id: 'team-tier-is-not-the-individual-tier',
    family: 'different_subject',
    recorded: { kind: 'constraint', title: 'Do not charge for the individual tier' },
    proposed: { kind: 'constraint', title: 'Charge for the team tier' },
    expected: 'novel',
    why: '§14 forbids charging individuals and expects revenue from teams. The two share almost all their vocabulary and conflict in none of it.',
  }),
  build({
    id: 'two-sessions-two-costs',
    family: 'different_subject',
    recorded: { kind: 'fact', title: 'Extraction cost 0.05 dollars for the 1357 turn session' },
    proposed: { kind: 'fact', title: 'Extraction cost 0.0017 dollars for the 18 turn session' },
    expected: 'novel',
    why: 'Two measurements of two different sessions. Every number differs and nothing conflicts, because the numbers are keyed to subjects the classifier cannot see.',
  }),
  build({
    id: 'workspace-id-refined-with-rls-detail',
    family: 'refinement',
    recorded: { kind: 'constraint', title: 'Every tenant row carries a workspace_id' },
    proposed: {
      kind: 'constraint',
      title:
        'Every tenant row carries a workspace_id, and RLS policies key on the workspace_id GUC',
    },
    expected: 'novel',
    why: 'A refinement that adds the enforcement mechanism. It restates the recorded claim and extends it, without disagreeing with any part of it.',
  }),
  build({
    id: 'p95-and-p99-are-different-aspects',
    family: 'different_subject',
    recorded: { kind: 'fact', title: 'Rehydrate p95 measured 280ms on the seeded corpus' },
    proposed: { kind: 'fact', title: 'Rehydrate p99 measured 460ms on the seeded corpus' },
    expected: 'novel',
    why: 'Same corpus, same run, different percentile. A higher p99 than p95 is arithmetic, not disagreement.',
  }),
  build({
    id: 'revoked-claim-quoted-not-asserted',
    family: 'reported_not_asserted',
    recorded: {
      kind: 'constraint',
      title: 'Never restate the revoked claim that content stays on the machine',
    },
    proposed: {
      kind: 'constraint',
      title: 'The package description restated the revoked claim that content stays on the machine',
    },
    expected: 'novel',
    why: 'The candidate reports where the revoked claim reappeared. It quotes the claim rather than asserting it, so it supports the constraint instead of contradicting it.',
  }),
  build({
    id: 'conflict-escalation-restates-the-rule',
    family: 'reported_not_asserted',
    recorded: { kind: 'constraint', title: 'Never auto-resolve a human versus human conflict' },
    proposed: {
      kind: 'constraint',
      title: 'Escalate a human versus human conflict to a human reviewer instead of auto-resolving',
    },
    expected: 'novel',
    why: 'Standing rule 3 stated in the affirmative. The prohibition and the escalation are the same policy described from opposite ends.',
  }),
  build({
    id: 'send-guard-described-from-the-other-side',
    family: 'reported_not_asserted',
    recorded: {
      kind: 'constraint',
      title: 'The waitlist CLI previews a campaign and sends nothing without --send',
    },
    proposed: {
      kind: 'constraint',
      title: 'The waitlist CLI sends a campaign only when --send is passed',
    },
    expected: 'novel',
    why: 'One send guard, two descriptions. The negation in the recorded title scopes a clause rather than the claim, so stance alone reads them as opposites.',
  }),
  build({
    id: 'secrets-and-user-content-are-different-rules',
    family: 'different_subject',
    recorded: { kind: 'constraint', title: 'Never log user content in a telemetry event' },
    proposed: { kind: 'constraint', title: 'Never log a secret in a commit message' },
    expected: 'novel',
    why: 'Two prohibitions that share the verb and nothing else. A classifier keying on shared vocabulary alone would pair them.',
  }),
  build({
    id: 'same-text-different-kind',
    family: 'different_subject',
    recorded: { kind: 'decision', title: 'The staging database runs Postgres 18' },
    proposed: { kind: 'fact', title: 'The staging database runs Postgres 18' },
    expected: 'novel',
    why: 'A decision to run Postgres 18 and the observation that it is running are different rows in §9. Kind isolation has to survive any change to the scoring.',
  }),
  build({
    id: 'concurrency-bound-given-a-number',
    family: 'refinement',
    recorded: { kind: 'constraint', title: 'Bound the concurrency when embedding items' },
    proposed: { kind: 'constraint', title: 'Bound the concurrency to 8 when embedding items' },
    expected: 'novel',
    why: 'A value arriving where the recorded item had none. That is a refinement, not a value conflict, because there is no earlier number for 8 to disagree with.',
  }),
  build({
    id: 'rationale-recorded-at-last',
    family: 'refinement',
    recorded: {
      kind: 'decision',
      title: 'Use Postgres for the store rather than adding Redis',
      body: 'One dependency keeps the operational surface small.',
    },
    proposed: {
      kind: 'decision',
      title: 'Use Postgres for the store rather than adding Redis',
      body: 'pgvector covers the semantic search we thought needed a second engine.',
    },
    expected: 'novel',
    why: 'The same decision with new reasoning behind it. Worth carrying, and not a disagreement with anything.',
  }),
  build({
    id: 'unchanged-decision-recheckpointed',
    family: 'unchanged',
    recorded: { kind: 'decision', title: 'Use Postgres for the store rather than adding Redis' },
    proposed: { kind: 'decision', title: 'Use Postgres for the store rather than adding Redis' },
    expected: 'duplicate',
    why: 'The same session checkpointed twice. Re-recording it costs a second review and settles nothing.',
  }),
  build({
    id: 'unchanged-decision-reworded',
    family: 'unchanged',
    recorded: {
      kind: 'decision',
      title: 'Adopt Biome for formatting and linting across the monorepo',
    },
    proposed: {
      kind: 'decision',
      title: 'Adopt Biome across the monorepo for linting and formatting',
    },
    expected: 'duplicate',
    why: 'Identical claim, different word order. Nothing here is new and nothing conflicts.',
  }),
  build({
    id: 'unchanged-constraint-with-identical-body',
    family: 'unchanged',
    recorded: {
      kind: 'constraint',
      title: 'Never log user content',
      body: 'Telemetry redacts item bodies before the event is emitted.',
    },
    proposed: {
      kind: 'constraint',
      title: 'Never log user content',
      body: 'Telemetry redacts item bodies before the event is emitted.',
    },
    expected: 'duplicate',
    why: 'Title and body both unchanged. The body path must not turn an unchanged item into a new one.',
  }),
];
