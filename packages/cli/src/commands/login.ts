import { mkdir, writeFile } from 'node:fs/promises';
import { hostname, userInfo } from 'node:os';
import { dirname } from 'node:path';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import { credentialsPath, resolveAuthUrl } from '../config.js';
import {
  type DeviceCodeGrant,
  type Fetch,
  fetchIdentity,
  type Identity,
  pollForToken,
  requestDeviceCode,
} from './device-auth.js';

export interface LoginDeps {
  readonly fetchImpl?: Fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly writeCredentials?: (path: string, token: string) => Promise<void>;
  readonly clientLabel?: () => string;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const defaultClientLabel = (): string => {
  try {
    return `${userInfo().username} on ${hostname()}`;
  } catch {
    return 'mneia cli';
  }
};

const defaultWriteCredentials = async (path: string, token: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${token}\n`, { encoding: 'utf8', mode: 0o600 });
};

const renderPrompt = (grant: DeviceCodeGrant): string =>
  [
    '',
    `  Open  ${grant.verificationUriComplete}`,
    '',
    `  Code                 ${grant.userCode}`,
    `  Confirmation number  ${grant.confirmationCode}`,
    '',
    '  Approve it there, and check the workspace named on that page is the one you expect.',
    '  Waiting…',
    '',
  ].join('\n');

const renderSuccess = (identity: Identity, path: string): string =>
  [
    '',
    `  Signed in to ${identity.workspace.displayName} as ${identity.actor.displayName}.`,
    `  Token written to ${path}`,
    '',
  ].join('\n');

export function createLoginCommand(deps: LoginDeps = {}): CommandDefinition {
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const writeCredentials = deps.writeCredentials ?? defaultWriteCredentials;
  const clientLabel = deps.clientLabel ?? defaultClientLabel;

  return {
    name: 'login',
    summary: 'sign this machine in to a Mneia workspace',
    usage: 'mneia login [--json]',

    async run({ io, json }: CommandInvocation): Promise<number> {
      const authUrl = resolveAuthUrl(io.env);
      const grant = await requestDeviceCode(authUrl, clientLabel(), fetchImpl);

      if (!json) {
        io.stdout(renderPrompt(grant));
      }

      const deadline = now() + grant.expiresIn * 1000;
      let interval = grant.interval;

      while (now() < deadline) {
        await sleep(interval * 1000);
        const outcome = await pollForToken(authUrl, grant.deviceCode, fetchImpl);

        if (outcome.kind === 'issued') {
          const path = credentialsPath(io.env);
          await writeCredentials(path, outcome.token.accessToken);
          const identity = await fetchIdentity(authUrl, outcome.token.accessToken, fetchImpl);

          if (json) {
            io.stdout(
              `${JSON.stringify({
                signed_in: true,
                credentials_path: path,
                actor: identity.actor,
                workspace: identity.workspace,
                team: identity.team,
              })}\n`,
            );
          } else {
            io.stdout(renderSuccess(identity, path));
          }
          return EXIT_OK;
        }

        if (outcome.kind === 'failed') {
          throw outcome.error;
        }

        if (outcome.kind === 'slow_down') {
          interval = Math.max(interval + 5, outcome.interval);
        } else {
          interval = outcome.interval;
        }
      }

      throw new CliError(
        'auth',
        `the sign-in request expired after ${grant.expiresIn} seconds without being approved`,
        'run mneia login again',
      );
    },
  };
}

export const loginCommand: CommandDefinition = createLoginCommand();
