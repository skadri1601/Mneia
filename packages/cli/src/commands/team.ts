import type { Actor, ActorKind, Uuid } from '@mneia/core';
import { shortenItemIds } from '@mneia/core';
import { callApi } from '../api.js';
import { actorNameFor, describeActorAttribution } from '../attribution.js';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { httpTeamApi } from '../http-api.js';
import type { ProjectConfig, ProjectConfigLoader } from './brief.js';

export interface RosterRequest {
  readonly config: ProjectConfig;
  readonly limit: number;
}

export interface Roster {
  readonly viewerId: Uuid;
  readonly actors: readonly Actor[];
}

export interface TeamApi {
  readonly roster: (request: RosterRequest) => Promise<Roster>;
}

export interface TeamDeps {
  readonly api: TeamApi;
  readonly loadConfig: ProjectConfigLoader;
}

export const DEFAULT_TEAM_LIMIT = 200;
export const MAX_TEAM_LIMIT = 500;
export const MIN_ACTOR_REFERENCE_LENGTH = 4;

const USAGE = 'mneia team [--limit <count>] [--json]';

const HYPHENS = /-/g;
const HEX_REFERENCE = /^[0-9a-f-]+$/;

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function assertNoPositionals(args: readonly string[]): void {
  if (args.length === 0) {
    return;
  }
  throw usageError(`mneia team takes no positional arguments; got ${args.join(' ')}`);
}

function readLimit(flags: CommandInvocation['flags']): number {
  const raw = flags.limit;
  if (raw === undefined) {
    return DEFAULT_TEAM_LIMIT;
  }
  if (typeof raw !== 'string') {
    throw usageError('--limit needs a number of actors');
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw usageError(`--limit expects a positive whole number of actors; got ${raw}`);
  }
  if (parsed > MAX_TEAM_LIMIT) {
    throw usageError(`--limit is capped at ${MAX_TEAM_LIMIT} actors; got ${raw}`);
  }
  return parsed;
}

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
  return `${describeActorAttribution(actor, actor.id)} [${shortActorId(actor, shortIds)}]`;
}

interface ReferenceMatch {
  readonly actor: Actor;
  readonly exact: boolean;
}

function matchOne(actor: Actor, reference: string): ReferenceMatch | null {
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

export function matchActors(
  actors: readonly Actor[],
  reference: string,
): readonly ReferenceMatch[] {
  const matched = actors
    .map((actor) => matchOne(actor, reference))
    .filter((match): match is ReferenceMatch => match !== null);

  const exact = matched.filter((match) => match.exact);
  return exact.length > 0 ? exact : matched;
}

function candidateLines(
  matches: readonly ReferenceMatch[],
  shortIds: ReadonlyMap<Uuid, string>,
): string {
  return matches.map((match) => describeActor(match.actor, shortIds)).join(', ');
}

export function resolveActorReference(reference: string, roster: Roster, flag: string): Actor {
  const trimmed = reference.trim();
  const shortIds = shortActorIds(roster.actors);
  const matches = matchActors(roster.actors, trimmed);
  const matched = matches[0];

  if (matches.length === 0 || matched === undefined) {
    throw new CliError(
      'usage',
      `${flag} expected the name, email, or id of somebody in this workspace; nobody there matches "${trimmed}" among ${roster.actors.length} ${roster.actors.length === 1 ? 'actor' : 'actors'}`,
      'run mneia team to see who is in this workspace, then pass a name, an email, or the id it prints in [brackets]',
    );
  }

  if (matches.length > 1) {
    throw new CliError(
      'usage',
      `${flag} matched ${matches.length} actors for "${trimmed}": ${candidateLines(matches, shortIds)}`,
      'pass the full name, the email, or the id in [brackets] — a handoff goes to one person',
    );
  }

  return matched.actor;
}

const countOf = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

function kindTally(actors: readonly Actor[]): string {
  const humans = actors.filter((actor) => actor.kind === 'human').length;
  return `${countOf(humans, 'human')} · ${countOf(actors.length - humans, 'agent')}`;
}

function rosterLine(
  actor: Actor,
  roster: Roster,
  shortIds: ReadonlyMap<Uuid, string>,
  nameWidth: number,
): string {
  const marks: string[] = [actor.kind];
  if (actor.id === roster.viewerId) {
    marks.push('you');
  }
  if (actor.externalRef !== null && actor.externalRef.trim().length > 0) {
    marks.push(actor.externalRef.trim());
  }
  return `  [${shortActorId(actor, shortIds)}]  ${actorNameFor(actor.displayName).padEnd(nameWidth)}  ${marks.join(' · ')}`;
}

function renderEmpty(config: ProjectConfig): string {
  return [
    `No actors are visible in workspace ${config.workspace}.`,
    '',
    'That should not happen while you are signed in — run mneia whoami, and report it if your own actor is missing.',
    '',
  ].join('\n');
}

function renderHuman(roster: Roster, config: ProjectConfig, limit: number): string {
  if (roster.actors.length === 0) {
    return renderEmpty(config);
  }

  const ordered = orderRoster(roster.actors);
  const shortIds = shortActorIds(roster.actors);
  const nameWidth = ordered.reduce(
    (widest, actor) => Math.max(widest, actorNameFor(actor.displayName).length),
    0,
  );
  const example = ordered.find((actor) => actor.id !== roster.viewerId) ?? ordered[0];

  const header = [
    `${config.workspace} — ${countOf(roster.actors.length, 'actor')} in this workspace, humans first`,
    `${kindTally(roster.actors)} · limit ${limit}`,
  ].join('\n');

  const footer =
    example === undefined
      ? 'Address a handoff with: mneia handoff "<next action>" --to <name>'
      : `Address a handoff with: mneia handoff "<next action>" --to ${shortActorId(example, shortIds)}`;

  return `${[
    header,
    ordered.map((actor) => rosterLine(actor, roster, shortIds, nameWidth)).join('\n'),
    footer,
  ].join('\n\n')}\n`;
}

interface TeamJsonActor {
  readonly id: Uuid;
  readonly shortId: string;
  readonly displayName: string;
  readonly kind: ActorKind;
  readonly human: boolean;
  readonly externalRef: string | null;
  readonly you: boolean;
  readonly createdAt: string;
}

function renderJson(roster: Roster, config: ProjectConfig, limit: number): string {
  const ordered = orderRoster(roster.actors);
  const shortIds = shortActorIds(roster.actors);
  const payload = {
    workspace: config.workspace,
    viewerId: roster.viewerId,
    limit,
    count: roster.actors.length,
    actors: ordered.map(
      (actor): TeamJsonActor => ({
        id: actor.id,
        shortId: shortActorId(actor, shortIds),
        displayName: actor.displayName,
        kind: actor.kind,
        human: actor.kind === 'human',
        externalRef: actor.externalRef,
        you: actor.id === roster.viewerId,
        createdAt: actor.createdAt.toISOString(),
      }),
    ),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function createTeamCommand(deps: TeamDeps): CommandDefinition {
  return {
    name: 'team',
    summary: 'List the people and agents in this workspace, with the ids a handoff can address.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      assertNoPositionals(invocation.args);
      const limit = readLimit(invocation.flags);
      const config = await deps.loadConfig(invocation.io.cwd, invocation.io.env);
      const roster = await callApi(config.endpoint, 'team', () =>
        deps.api.roster({ config, limit }),
      );

      invocation.io.stdout(
        invocation.json ? renderJson(roster, config, limit) : renderHuman(roster, config, limit),
      );
      return EXIT_OK;
    },
  };
}

const defaultLoadConfig: ProjectConfigLoader = async (cwd, env) => {
  const { requireProjectConfig } = await import('../config.js');
  return requireProjectConfig(cwd, env);
};

export const teamCommand: CommandDefinition = createTeamCommand({
  api: httpTeamApi,
  loadConfig: defaultLoadConfig,
});
