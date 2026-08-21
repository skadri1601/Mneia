import { actorNameFor } from '../attribution.js';
import { type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { resolveAuthUrl, resolveToken } from '../config.js';
import { type Fetch, fetchIdentity, type Identity } from './device-auth.js';

export interface WhoamiDeps {
  readonly fetchImpl?: Fetch;
  readonly readToken?: (env: Readonly<Record<string, string | undefined>>) => Promise<string>;
}

const render = (identity: Identity): string =>
  [
    '',
    `  Actor      ${actorNameFor(identity.actor.displayName)} (${identity.actor.kind})`,
    `  Workspace  ${identity.workspace.displayName} (${identity.workspace.slug})`,
    `  Team       ${identity.team.displayName}`,
    '',
  ].join('\n');

export function createWhoamiCommand(deps: WhoamiDeps = {}): CommandDefinition {
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const readToken = deps.readToken ?? resolveToken;

  return {
    name: 'whoami',
    summary: 'show the actor, workspace, and team this machine is signed in as',
    usage: 'mneia whoami [--json]',

    async run({ io, json }: CommandInvocation): Promise<number> {
      const token = await readToken(io.env);
      const identity = await fetchIdentity(resolveAuthUrl(io.env), token, fetchImpl);

      if (json) {
        io.stdout(
          `${JSON.stringify({
            actor: identity.actor,
            workspace: identity.workspace,
            team: identity.team,
          })}\n`,
        );
      } else {
        io.stdout(render(identity));
      }

      return EXIT_OK;
    },
  };
}

export const whoamiCommand: CommandDefinition = createWhoamiCommand();
