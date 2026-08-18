import { CliError, type CommandIo } from './command.js';
import { type Fetch, fetchIdentity, type Identity } from './commands/device-auth.js';
import { loadProjectConfig, resolveAuthUrl, resolveToken } from './config.js';
import type { SessionContext } from './session.js';

export interface PreflightDeps {
  readonly io: CommandIo;
  readonly signIn: () => Promise<number>;
  readonly fetchImpl?: Fetch;
  readonly readToken?: (env: Readonly<Record<string, string | undefined>>) => Promise<string>;
  readonly readProject?: typeof loadProjectConfig;
}

const isAuthFailure = (error: unknown): error is CliError =>
  error instanceof CliError && error.kind === 'auth';

async function readIdentity(
  io: CommandIo,
  readToken: NonNullable<PreflightDeps['readToken']>,
  fetchImpl: Fetch,
): Promise<Identity> {
  const token = await readToken(io.env);
  return fetchIdentity(resolveAuthUrl(io.env), token, fetchImpl);
}

async function readProjectLabel(
  io: CommandIo,
  readProject: typeof loadProjectConfig,
): Promise<string | null> {
  try {
    const config = await readProject(io.cwd, io.env);
    return config === null ? null : config.project;
  } catch {
    return null;
  }
}

export function createSessionPreflight(deps: PreflightDeps): () => Promise<SessionContext> {
  const fetchImpl = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  const readToken = deps.readToken ?? resolveToken;
  const readProject = deps.readProject ?? loadProjectConfig;
  const { io } = deps;

  return async (): Promise<SessionContext> => {
    const project = await readProjectLabel(io, readProject);
    let identity: Identity | null = null;

    try {
      identity = await readIdentity(io, readToken, fetchImpl);
    } catch (error) {
      if (!isAuthFailure(error)) {
        io.stderr(
          `\n  Could not confirm who this machine is signed in as: ${error instanceof Error ? error.message : String(error)}\n  Starting the session anyway — each command will report its own failure.\n`,
        );
        return { actor: null, workspace: null, project, directory: io.cwd };
      }

      io.stdout(`\n  ${error.message}\n  Signing in now.\n`);

      const code = await deps.signIn();

      if (code !== 0) {
        return { actor: null, workspace: null, project, directory: io.cwd };
      }

      try {
        identity = await readIdentity(io, readToken, fetchImpl);
      } catch {
        return { actor: null, workspace: null, project, directory: io.cwd };
      }
    }

    return {
      actor: identity.actor.displayName,
      workspace: identity.workspace.displayName,
      project,
      directory: io.cwd,
    };
  };
}
