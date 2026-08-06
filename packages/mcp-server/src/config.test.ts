import { describe, expect, it } from 'vitest';
import type { EnvLike, FileReader } from './config.js';
import {
  ConfigError,
  credentialsPath,
  DEFAULT_ENDPOINT,
  describeConfigError,
  ENDPOINT_ENV_VAR,
  loadServerConfig,
  projectConfigPath,
  TELEMETRY_ENV_VAR,
  TOKEN_ENV_VAR,
} from './config.js';

const CWD = '/workspace/payments';
const TOKEN = 'mnt_live_9f3c1a2b4d5e6f70';

function reader(files: Readonly<Record<string, string>>): FileReader {
  return (path) => {
    const content = files[path];
    if (content === undefined) {
      return Promise.reject(
        Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
          code: 'ENOENT',
        }),
      );
    }
    return Promise.resolve(content);
  };
}

function load(env: EnvLike, files: Readonly<Record<string, string>> = {}) {
  return loadServerConfig({ env, cwd: CWD, readTextFile: reader(files) });
}

async function failure(
  env: EnvLike,
  files: Readonly<Record<string, string>> = {},
): Promise<ConfigError> {
  try {
    await load(env, files);
  } catch (cause) {
    expect(cause).toBeInstanceOf(ConfigError);
    return cause as ConfigError;
  }
  throw new Error('expected loadServerConfig to reject; it resolved');
}

describe('loadServerConfig', () => {
  it('accepts a well-formed environment and applies the documented defaults', async () => {
    const config = await load({ [TOKEN_ENV_VAR]: TOKEN });

    expect(config.token).toBe(TOKEN);
    expect(config.endpoint).toBe(DEFAULT_ENDPOINT);
    expect(config.telemetryEnabled).toBe(true);
    expect(config.project).toBeNull();
  });

  it('trims a token that arrived with a trailing newline', async () => {
    const config = await load({ [TOKEN_ENV_VAR]: `${TOKEN}\n` });

    expect(config.token).toBe(TOKEN);
  });

  it('reads the token from the credentials file when the variable is unset', async () => {
    const path = credentialsPath({});
    const config = await load({}, { [path]: `${TOKEN}\n` });

    expect(config.token).toBe(TOKEN);
  });

  it('honours an absolute MNEIA_CREDENTIALS_PATH override', async () => {
    const override = credentialsPath({ MNEIA_CREDENTIALS_PATH: '/tmp/mneia-credentials' });
    const config = await load({ MNEIA_CREDENTIALS_PATH: override }, { [override]: TOKEN });

    expect(config.token).toBe(TOKEN);
  });
});

describe('loadServerConfig token failures', () => {
  it('names MNEIA_TOKEN and mneia login when no credentials exist anywhere', async () => {
    const error = await failure({});

    expect(error.variable).toBe(TOKEN_ENV_VAR);
    expect(error.message).toContain(TOKEN_ENV_VAR);
    expect(error.message).toContain('local.json');
    expect(describeConfigError(error)).toContain('mneia-mcp cannot start');
  });

  it('names MNEIA_TOKEN when it is set but empty', async () => {
    const error = await failure({ [TOKEN_ENV_VAR]: '   ' });

    expect(error.variable).toBe(TOKEN_ENV_VAR);
    expect(error.message).toContain('set but empty');
  });

  it('rejects a token pasted with its Bearer prefix', async () => {
    const error = await failure({ [TOKEN_ENV_VAR]: `Bearer ${TOKEN}` });

    expect(error.variable).toBe(TOKEN_ENV_VAR);
    expect(error.message).toContain('no spaces');
  });

  it('names the credentials file when it exists but is empty', async () => {
    const path = credentialsPath({});
    const error = await failure({}, { [path]: '\n' });

    expect(error.variable).toBe(TOKEN_ENV_VAR);
    expect(error.message).toContain(path);
    expect(error.message).toContain('empty');
  });
});

describe('loadServerConfig endpoint', () => {
  it('names MNEIA_API_URL when the value is not a URL', async () => {
    const error = await failure({ [TOKEN_ENV_VAR]: TOKEN, [ENDPOINT_ENV_VAR]: 'api.mneia.dev' });

    expect(error.variable).toBe(ENDPOINT_ENV_VAR);
    expect(error.message).toContain(ENDPOINT_ENV_VAR);
    expect(error.message).toContain(DEFAULT_ENDPOINT);
  });

  it('names MNEIA_API_URL when the scheme is neither http nor https', async () => {
    const error = await failure({
      [TOKEN_ENV_VAR]: TOKEN,
      [ENDPOINT_ENV_VAR]: 'ftp://api.mneia.dev',
    });

    expect(error.variable).toBe(ENDPOINT_ENV_VAR);
    expect(error.message).toContain('http or https');
  });

  it('accepts an explicit endpoint override', async () => {
    const config = await load({
      [TOKEN_ENV_VAR]: TOKEN,
      [ENDPOINT_ENV_VAR]: 'https://api.staging.mneia.dev',
    });

    expect(config.endpoint).toBe('https://api.staging.mneia.dev');
  });
});

describe('loadServerConfig telemetry', () => {
  it('treats MNEIA_TELEMETRY=off as an opt-out', async () => {
    const config = await load({ [TOKEN_ENV_VAR]: TOKEN, [TELEMETRY_ENV_VAR]: 'OFF' });

    expect(config.telemetryEnabled).toBe(false);
  });

  it('treats MNEIA_TELEMETRY=on as an opt-in', async () => {
    const config = await load({ [TOKEN_ENV_VAR]: TOKEN, [TELEMETRY_ENV_VAR]: 'on' });

    expect(config.telemetryEnabled).toBe(true);
  });

  it('names MNEIA_TELEMETRY rather than silently leaving telemetry on for a typo', async () => {
    const error = await failure({ [TOKEN_ENV_VAR]: TOKEN, [TELEMETRY_ENV_VAR]: '0ff' });

    expect(error.variable).toBe(TELEMETRY_ENV_VAR);
    expect(error.message).toContain('0ff');
    expect(error.message).toContain('opt out');
  });
});

describe('loadServerConfig project binding', () => {
  const path = projectConfigPath(CWD);

  it('reads the project binding written by mneia init', async () => {
    const config = await load(
      { [TOKEN_ENV_VAR]: TOKEN },
      { [path]: JSON.stringify({ workspace: 'acme', project: 'payments-migration' }) },
    );

    expect(config.project).toEqual({
      workspace: 'acme',
      project: 'payments-migration',
      configPath: path,
    });
  });

  it('lets the project config supply the endpoint, and the environment override it', async () => {
    const file = JSON.stringify({
      workspace: 'acme',
      project: 'payments-migration',
      endpoint: 'https://api.acme-internal.example',
    });

    const fromFile = await load({ [TOKEN_ENV_VAR]: TOKEN }, { [path]: file });
    expect(fromFile.endpoint).toBe('https://api.acme-internal.example');

    const overridden = await load(
      { [TOKEN_ENV_VAR]: TOKEN, [ENDPOINT_ENV_VAR]: DEFAULT_ENDPOINT },
      { [path]: file },
    );
    expect(overridden.endpoint).toBe(DEFAULT_ENDPOINT);
  });

  it('names the file when it is not valid JSON', async () => {
    const error = await failure({ [TOKEN_ENV_VAR]: TOKEN }, { [path]: '{ workspace: acme' });

    expect(error.variable).toBe(path);
    expect(error.message).toContain('not valid JSON');
    expect(error.message).toContain('pass the project name to each tool call');
  });

  it('names the missing field when the binding is incomplete', async () => {
    const error = await failure(
      { [TOKEN_ENV_VAR]: TOKEN },
      { [path]: JSON.stringify({ workspace: 'acme' }) },
    );

    expect(error.variable).toBe(path);
    expect(error.message).toContain('project');
  });

  it('does not fail when no project is bound, because tools accept an explicit project', async () => {
    const config = await load({ [TOKEN_ENV_VAR]: TOKEN });

    expect(config.project).toBeNull();
    expect(config.cwd).toContain('payments');
  });
});
