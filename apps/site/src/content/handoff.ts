export type Provenance = 'human' | 'agent' | 'agent-confirmed';

export type ConstraintLine = {
  provenance: Provenance;
  marker: string;
  text: string;
};

export type DecisionLine = {
  provenance: Provenance;
  marker: string;
  text: string;
  rationale: string;
};

export type SupersededLine = {
  struck: string;
  note: string;
};

export const HANDOFF = {
  path: 'handoff/payments-migration.md',
  title: 'Handoff: payments-migration',
  from: 'Saad (human)',
  sentAt: '2026-07-26 18:40 UTC',
  to: 'open',
  nextAction: {
    lead: 'Wire the retry path in ',
    code: 'charges/worker.rb',
    tail: ' to the new idempotency key. Nothing else is blocking.',
  },
  state: [
    'Ledger writes are cut over and green in staging. Read path is still dual-reading.',
    'Rollback flag payments.v2_reads is live and tested.',
  ],
  constraints: [
    {
      provenance: 'human',
      marker: 'human · confirmed 2026-07-14',
      text: 'No downtime window. Cutover must be online.',
    },
    {
      provenance: 'human',
      marker: 'human · confirmed 2026-07-02',
      text: 'Idempotency keys are namespaced per merchant, not global.',
    },
    {
      provenance: 'agent',
      marker: 'agent · claude-code · unconfirmed',
      text: 'Stripe webhook ordering is not guaranteed; do not rely on it.',
    },
  ] satisfies ConstraintLine[],
  decisions: [
    {
      provenance: 'human',
      marker: '2026-07-11 · human',
      text: 'Postgres advisory locks over Redis for the cutover lock.',
      rationale:
        'Rationale: we already page on Postgres; adding a Redis dependency to the critical path was rejected.',
    },
    {
      provenance: 'agent-confirmed',
      marker: '2026-07-19 · agent, human-confirmed',
      text: 'Dual-read window set to 14 days, not 7.',
      rationale: 'Rationale: month-end reconciliation needs a full cycle inside the window.',
    },
  ] satisfies DecisionLine[],
  openQuestions: [
    'Who owns the backfill for pre-2024 charges? Unassigned since 2026-07-08.',
    'Do we need the dual-read window extended for EU entities? Raised by agent, unverified.',
  ],
  superseded: [
    {
      struck: 'Redis-based cutover lock',
      note: 'superseded 2026-07-11, see decision above.',
    },
    {
      struck: '7-day dual-read window',
      note: 'superseded 2026-07-19.',
    },
  ] satisfies SupersededLine[],
  artifacts: ['PR #2841 (ledger cutover)', 'ADR-017'],
} as const;
