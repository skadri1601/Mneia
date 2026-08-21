import type { ActorKind, ContextItem, Uuid } from '@mneia/core';

export const UNNAMED_ACTOR = 'an unnamed actor';
export const UNKNOWN_ACTOR_KIND = 'kind unknown';
export const HUMAN_CONFIRMED_MARK = 'human-confirmed';
export const NOT_HUMAN_CONFIRMED_MARK = 'not human-confirmed';

const META_FIELD_MARKERS = /[[\]()·]/g;
const WHITESPACE_RUN = /\s+/g;

export function actorNameFor(displayName: string): string {
  const cleaned = displayName.replace(META_FIELD_MARKERS, ' ').replace(WHITESPACE_RUN, ' ').trim();
  return cleaned === '' ? UNNAMED_ACTOR : cleaned;
}

export interface AttributedActor {
  readonly displayName: string;
  readonly kind: ActorKind;
}

export function describeActorAttribution(
  actor: AttributedActor | null | undefined,
  actorId: Uuid | string,
): string {
  if (actor === null || actor === undefined) {
    return `${UNNAMED_ACTOR} (${UNKNOWN_ACTOR_KIND}, ${actorId.slice(0, 8)})`;
  }
  return `${actorNameFor(actor.displayName)} (${actor.kind})`;
}

export function describeAsserter(item: ContextItem): string {
  const provenance = item.provenance;
  if (provenance === undefined) {
    return `by ${describeActorAttribution(undefined, item.assertedBy)}`;
  }
  return `by ${describeActorAttribution({ displayName: provenance.actorDisplayName, kind: provenance.actorKind }, item.assertedBy)}`;
}

export const confirmationMark = (humanConfirmed: boolean): string =>
  humanConfirmed ? HUMAN_CONFIRMED_MARK : NOT_HUMAN_CONFIRMED_MARK;
