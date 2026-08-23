import { mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError } from './command.js';
import {
  CONFIG_DIR,
  credentialsPath,
  DEFAULT_ENDPOINT,
  ENDPOINT_ENV_VAR,
  HOME_ENV_VAR,
  mneiaHomeDir,
  requireProjectConfig,
  resolveEndpoint,
} from './config.js';
import { localConfigPath } from './local-binding.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const HUMAN_ACTOR_ID = '33333333-3333-4333-8333-333333333333';

const tempHome = (): Promise<string> => mkdtemp(join(tmpdir(), 'mneia-home-'));

describe('mneiaHomeDir', () => {
  it('defaults to .mneia under the operating system home directory', () => {
    expect(mneiaHomeDir({})).toBe(join(homedir(), CONFIG_DIR));
  });

  it('honours an absolute MNEIA_HOME', () => {
    const absolute = resolve(tmpdir(), 'mneia-home-override');

    expect(mneiaHomeDir({ [HOME_ENV_VAR]: absolute })).toBe(absolute);
  });

  it('ignores a relative MNEIA_HOME rather than resolving it against the working directory', () => {
    expect(mneiaHomeDir({ [HOME_ENV_VAR]: '.mneia-relative' })).toBe(join(homedir(), CONFIG_DIR));
  });

  it('moves the credentials and the local binding together, so login and the MCP server agree', () => {
    const home = resolve(tmpdir(), 'mneia-home-together');
    const env = { [HOME_ENV_VAR]: home };

    expect(credentialsPath(env)).toBe(join(home, 'credentials'));
    expect(localConfigPath(env)).toBe(join(home, 'local.json'));
  });

  it('keeps a more specific path override winning over MNEIA_HOME', () => {
    const home = resolve(tmpdir(), 'mneia-home-specific');
    const credentials = resolve(tmpdir(), 'somewhere-else', 'credentials');

    expect(credentialsPath({ [HOME_ENV_VAR]: home, MNEIA_CREDENTIALS_PATH: credentials })).toBe(
      credentials,
    );
  });
});

describe('test isolation', () => {
  it('never lets this suite resolve the real ~/.mneia', () => {
    expect(mneiaHomeDir(process.env)).not.toBe(join(homedir(), CONFIG_DIR));
    expect(credentialsPath(process.env).startsWith(join(homedir(), CONFIG_DIR))).toBe(false);
    expect(localConfigPath(process.env).startsWith(join(homedir(), CONFIG_DIR))).toBe(false);
  });
});

describe('resolveEndpoint', () => {
  it('treats a set-but-empty MNEIA_API_URL as unset rather than letting it beat the default', () => {
    expect(resolveEndpoint({ [ENDPOINT_ENV_VAR]: '' }, undefined)).toBe(DEFAULT_ENDPOINT);
    expect(resolveEndpoint({ [ENDPOINT_ENV_VAR]: '   ' }, undefined)).toBe(DEFAULT_ENDPOINT);
  });

  it('names the variable and the value when MNEIA_API_URL is not a URL at all', () => {
    const thrown = (): unknown => {
      try {
        return resolveEndpoint({ [ENDPOINT_ENV_VAR]: 'not a url' }, undefined);
      } catch (cause) {
        return cause;
      }
    };

    const error = thrown();
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).kind).toBe('not_configured');
    expect((error as CliError).message).toContain(ENDPOINT_ENV_VAR);
    expect((error as CliError).message).toContain('not a url');
    expect((error as CliError).fix).not.toContain('retry');
  });

  it('refuses a scheme that is not http or https', () => {
    let error: unknown;
    try {
      resolveEndpoint({ [ENDPOINT_ENV_VAR]: 'ftp://example.com' }, undefined);
    } catch (cause) {
      error = cause;
    }

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toContain('ftp');
  });

  it('prefers the environment, then the config file, then the default', () => {
    expect(
      resolveEndpoint({ [ENDPOINT_ENV_VAR]: 'https://env.example' }, 'https://file.example'),
    ).toBe('https://env.example');
    expect(resolveEndpoint({}, 'https://file.example')).toBe('https://file.example');
    expect(resolveEndpoint({}, undefined)).toBe(DEFAULT_ENDPOINT);
  });
});

describe('requireProjectConfig', () => {
  it('reports an unbound repo by naming the home binding it actually looked for', async () => {
    const home = await tempHome();
    const cwd = await tempHome();

    const error = await requireProjectConfig(cwd, { [HOME_ENV_VAR]: home }).then(
      () => null,
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).kind).toBe('not_configured');
    expect((error as CliError).message).toContain(join(home, 'local.json'));
    expect((error as CliError).message).not.toContain(join(homedir(), CONFIG_DIR));
  });

  it('falls back to the home binding when the repo has no config', async () => {
    const home = await tempHome();
    const cwd = await tempHome();
    await writeFile(
      join(home, 'local.json'),
      JSON.stringify({
        workspaceId: WORKSPACE_ID,
        humanActorId: HUMAN_ACTOR_ID,
        projectSlug: 'checkout',
      }),
      'utf8',
    );

    const config = await requireProjectConfig(cwd, { [HOME_ENV_VAR]: home });

    expect(config.workspace).toBe(WORKSPACE_ID);
    expect(config.project).toBe('checkout');
    expect(config.configPath).toBe(join(home, 'local.json'));
  });
});
