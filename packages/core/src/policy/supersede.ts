import type { ContextItem, Uuid } from '../domain/types.js';
import type { ActorKind } from '../store/schema.js';

export type SupersedeVerdict =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'requires_human_confirmation'; readonly reason: string }
  | { readonly outcome: 'refused'; readonly reason: string };

export type SupersedeOutcome = SupersedeVerdict['outcome'];

export type SupersedeBlockedOutcome = Exclude<SupersedeOutcome, 'allowed'>;

export interface SupersedeRequest {
  readonly existing: ContextItem;
  readonly assertingActorKind: ActorKind;
  readonly assertingActorId: Uuid;
  readonly humanConfirmedByAsserter?: boolean;
}

const requiresHumanConfirmation = (reason: string): SupersedeVerdict => ({
  outcome: 'requires_human_confirmation',
  reason,
});

const refuse = (reason: string): SupersedeVerdict => ({ outcome: 'refused', reason });

export function evaluateSupersede(input: SupersedeRequest): SupersedeVerdict {
  const { existing, assertingActorKind, assertingActorId, humanConfirmedByAsserter } = input;

  if (assertingActorKind === 'agent' && existing.humanConfirmed) {
    return requiresHumanConfirmation(
      `context_item ${existing.id} is human_confirmed, and an agent assertion never auto-supersedes a human-confirmed item (vision.md §10.1 step 5, §10.4). Return it in the pending queue and store the agent assertion as a disputed item; apply the supersede only once a human confirms it directly. No flag on this request lifts that.`,
    );
  }

  if (existing.supersededById !== null) {
    return refuse(
      `context_item ${existing.id} has already been superseded by ${existing.supersededById}, and supersede applies only to the current head of a chain. Re-read the chain and supersede the revision that is still active.`,
    );
  }

  if (existing.status === 'superseded') {
    return refuse(
      `context_item ${existing.id} has status 'superseded', and supersede applies only to the current head of a chain. Re-read the chain and supersede the revision that is still active.`,
    );
  }

  if (existing.status === 'retired') {
    return refuse(
      `context_item ${existing.id} has status 'retired' and is no longer in force, so there is nothing to supersede. Write a new context_item instead of superseding a retired one.`,
    );
  }

  if (existing.status === 'disputed') {
    return requiresHumanConfirmation(
      `context_item ${existing.id} has status 'disputed' and is blocked until the conflict is resolved, so superseding it would silently resolve that conflict (vision.md §10.4). Resolve the conflict row and record the outcome, then supersede the item that survived.`,
    );
  }

  if (
    assertingActorKind === 'human' &&
    existing.humanConfirmed &&
    existing.assertedBy !== assertingActorId
  ) {
    return requiresHumanConfirmation(
      `context_item ${existing.id} is human_confirmed and was asserted by a different actor (${existing.assertedBy}), and human-versus-human conflicts are never auto-resolved (vision.md §10.4). Record a conflict row for the two items and surface it to both actors instead of overwriting one silently.`,
    );
  }

  if (assertingActorKind === 'agent' && existing.loadBearing && humanConfirmedByAsserter !== true) {
    return requiresHumanConfirmation(
      `context_item ${existing.id} is load_bearing, so an agent assertion does not supersede it without review (vision.md §10.1 step 5). Surface it for human confirmation and re-submit the supersede once a human has confirmed the replacement.`,
    );
  }

  return { outcome: 'allowed' };
}

export class SupersedeNotAllowedError extends Error {
  readonly outcome: SupersedeBlockedOutcome;
  readonly reason: string;
  readonly itemId: Uuid;

  constructor(itemId: Uuid, outcome: SupersedeBlockedOutcome, reason: string) {
    super(reason);
    this.name = 'SupersedeNotAllowedError';
    this.outcome = outcome;
    this.reason = reason;
    this.itemId = itemId;
  }
}

export function assertSupersedeAllowed(input: SupersedeRequest): void {
  const verdict = evaluateSupersede(input);

  if (verdict.outcome !== 'allowed') {
    throw new SupersedeNotAllowedError(input.existing.id, verdict.outcome, verdict.reason);
  }
}
