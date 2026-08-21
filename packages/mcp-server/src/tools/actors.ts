import type { Actor, ScopedStore, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';

export const ROSTER_LIMIT = 500;
export const MIN_ACTOR_REFERENCE_LENGTH = 4;

const HYPHENS = /-/g;
const HEX_REFERENCE = /^[0-9a-f-]+$/;

export interface WorkspaceActorFilterInput {
  readonly limit?: number;
}

export interface RosterCapableStore extends ScopedStore {
  listWorkspaceActors(filter?: WorkspaceActorFilterInput): Promise<readonly Actor[]>;
}

export const isRosterCapable = (store: ScopedStore): store is RosterCapableStore =>
  typeof (store as { listWorkspaceActors?: unknown }).listWorkspaceActors === 'function';

export const ROSTER_UNSUPPORTED_MESSAGE =
  'This server is bound to a store that cannot list the workspace roster. Upgrade @mneia/mcp-server so its @mneia/core ships listWorkspaceActors, or read the roster from the web app.';

const compactId = (id: string): string => id.replace(HYPHENS, '').toLowerCase();

export function shortActorIds(actors: readonly Actor[]): ReadonlyMap<Uuid, string> {
  return shortenItemIds(actors.map((actor) => actor.id));
}

export function shortActorId(actor: Actor, shortIds: ReadonlyMap<Uuid, string>): string {
  return shortIds.get(actor.id) ?? compactId(actor.id).slice(0, 8);
}

export function orderRoster(actors: readonly Actor[]): readonly Actor[] {
  return [...actors].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'human' ? -1 : 1;
    }
    const byName = left.displayName.localeCompare(right.displayName);
    return byName !== 0 ? byName : left.id.localeCompare(right.id);
  });
}

export function describeActor(actor: Actor, shortIds: ReadonlyMap<Uuid, string>): string {
  const externalRef =
    actor.externalRef === null || actor.externalRef.trim().length === 0
      ? ''
      : ` · ${actor.externalRef.trim()}`;
  return `${actor.displayName} (${actor.kind})${externalRef} [${shortActorId(actor, shortIds)}]`;
}

export function describeActorById(actors: readonly Actor[], id: Uuid | null): string {
  if (id === null) {
    return 'open — anyone in the workspace may pick it up';
  }
  const actor = actors.find((candidate) => candidate.id === id);
  if (actor === undefined) {
    return `an actor outside this workspace roster (${id})`;
  }
  return describeActor(actor, shortActorIds(actors));
}

export interface ActorMatch {
  readonly actor: Actor;
  readonly exact: boolean;
}

function matchOne(actor: Actor, reference: string): ActorMatch | null {
  const wanted = reference.toLowerCase();
  const compactWanted = compactId(wanted);
  const name = actor.displayName.trim().toLowerCase();
  const externalRef = actor.externalRef === null ? null : actor.externalRef.trim().toLowerCase();

  if (name === wanted || externalRef === wanted || compactId(actor.id) === compactWanted) {
    return { actor, exact: true };
  }
  if (
    HEX_REFERENCE.test(wanted) &&
    compactWanted.length >= MIN_ACTOR_REFERENCE_LENGTH &&
    compactId(actor.id).startsWith(compactWanted)
  ) {
    return { actor, exact: false };
  }
  if (name.startsWith(wanted) || externalRef?.startsWith(wanted) === true) {
    return { actor, exact: false };
  }
  return null;
}

export function matchActors(actors: readonly Actor[], reference: string): readonly ActorMatch[] {
  const matched = actors
    .map((actor) => matchOne(actor, reference))
    .filter((match): match is ActorMatch => match !== null);

  const exact = matched.filter((match) => match.exact);
  return exact.length > 0 ? exact : matched;
}

export type ActorReferenceCode = 'actor_not_found' | 'actor_ambiguous';

export class ActorReferenceError extends Error {
  readonly code: ActorReferenceCode;
  readonly reference: string;
  readonly candidates: readonly string[];

  constructor(
    code: ActorReferenceCode,
    reference: string,
    message: string,
    candidates: readonly string[],
  ) {
    super(message);
    this.name = 'ActorReferenceError';
    this.code = code;
    this.reference = reference;
    this.candidates = candidates;
  }
}

export function resolveActorReference(reference: string, actors: readonly Actor[]): Actor {
  const trimmed = reference.trim();
  const shortIds = shortActorIds(actors);
  const matches = matchActors(actors, trimmed);
  const matched = matches[0];

  if (matches.length === 0 || matched === undefined) {
    throw new ActorReferenceError(
      'actor_not_found',
      trimmed,
      `toActor expected the name, email, or id of somebody in this workspace; nobody there matches "${trimmed}" among ${actors.length} ${actors.length === 1 ? 'actor' : 'actors'}. Call mneia_team to see who is in this workspace, then pass a name, an email, or the id it returns.`,
      orderRoster(actors).map((actor) => describeActor(actor, shortIds)),
    );
  }

  if (matches.length > 1) {
    throw new ActorReferenceError(
      'actor_ambiguous',
      trimmed,
      `toActor matched ${matches.length} actors for "${trimmed}". Pass the full name, the email, or the actor id — a handoff goes to one person.`,
      matches.map((match) => describeActor(match.actor, shortIds)),
    );
  }

  return matched.actor;
}
