import { describe, expect, it } from 'vitest';
import { type CommandInvocation, EXIT_AUTH, EXIT_NETWORK } from '../command.js';
import { createLoginCommand } from './login.js';

const AUTH_URL = 'https://app.example.test';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const GRANT = {
  device_code: 'device-code-secret',
  user_code: 'BCDF-GHJK',
  confirmation_code: '0417',
  verification_uri: `${AUTH_URL}/device`,
  verification_uri_complete: `${AUTH_URL}/device?user_code=BCDF-GHJK`,
  expires_in: 900,
  interval: 5,
};

const IDENTITY = {
  actor: { id: 'actor-1', display_name: 'Ada Lovelace', kind: 'human' },
  workspace: { id: 'workspace-1', slug: 'ascend', display_name: 'Ascend' },
  team: { id: 'team-1', display_name: 'Default' },
};

interface Harness {
  readonly out: string[];
  readonly err: string[];
  readonly slept: number[];
  readonly written: { path: string; token: string }[];
  readonly requests: { url: string; init: RequestInit }[];
}

const invocationWith = (
  harness: Harness,
  json = false,
  env: Readonly<Record<string, string | undefined>> = {},
): CommandInvocation => ({
  args: [],
  flags: {},
  json,
  io: {
    stdout: (text) => harness.out.push(text),
    stderr: (text) => harness.err.push(text),
    cwd: '/repo',
    env: {
      MNEIA_AUTH_URL: AUTH_URL,
      MNEIA_CREDENTIALS_PATH: '/home/ada/.mneia/credentials',
      ...env,
    },
  },
});

const harnessWith = (responses: (Response | (() => Response))[]) => {
  const harness: Harness = { out: [], err: [], slept: [], written: [], requests: [] };
  let index = 0;

  const command = createLoginCommand({
    fetchImpl: async (url, init) => {
      harness.requests.push({ url, init });
      const next = responses[index++];
      if (next === undefined) throw new Error(`unexpected request ${index} to ${url}`);
      return typeof next === 'function' ? next() : next;
    },
    sleep: async (ms) => {
      harness.slept.push(ms);
    },
    now: () => 0,
    writeCredentials: async (path, token) => {
      harness.written.push({ path, token });
    },
    clientLabel: () => 'ada on laptop',
  });

  return { harness, command };
};

describe('mneia login', () => {
  it('shows the code and the confirmation number before it waits', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(200, {
        access_token: 'mneia_token',
        workspace_id: 'workspace-1',
        actor_id: 'actor-1',
      }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    const prompt = harness.out[0] ?? '';
    expect(prompt).toContain('BCDF-GHJK');
    expect(prompt).toContain('0417');
    expect(prompt).toContain(`${AUTH_URL}/device?user_code=BCDF-GHJK`);
  });

  it('tells the user to check the workspace named on the page, which is the phishing mitigation', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(200, { access_token: 'mneia_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    expect(harness.out[0] ?? '').toContain('check the workspace named on that page');
  });

  it('names the workspace it actually signed into, not the one the user assumed', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(200, { access_token: 'mneia_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    expect(harness.out.join('')).toContain('Signed in to Ascend as Ada Lovelace');
  });

  it('sends the client label so the approval page can say who asked', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(200, { access_token: 'mneia_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    expect(String(harness.requests[0]?.init.body)).toContain('ada on laptop');
  });

  it('keeps polling while the request is pending, at the interval the server asks for', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(400, { error: 'authorization_pending', interval: 5 }),
      jsonResponse(400, { error: 'authorization_pending', interval: 5 }),
      jsonResponse(200, { access_token: 'mneia_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    expect(harness.slept).toEqual([5000, 5000, 5000]);
    expect(harness.written).toHaveLength(1);
  });

  it('backs off when the server says slow_down rather than hammering it', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(400, { error: 'slow_down', interval: 5 }),
      jsonResponse(200, { access_token: 'mneia_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    expect(harness.slept).toEqual([5000, 10000]);
  });

  it('writes the token to the credentials path and nowhere else', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(200, { access_token: 'mneia_secret_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    expect(harness.written).toEqual([
      { path: '/home/ada/.mneia/credentials', token: 'mneia_secret_token' },
    ]);
  });

  it('never prints the token it just wrote', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(200, { access_token: 'mneia_secret_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness));

    expect(harness.out.join('')).not.toContain('mneia_secret_token');
  });

  it('does not print the token in --json either', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(200, { access_token: 'mneia_secret_token' }),
      jsonResponse(200, IDENTITY),
    ]);

    await command.run(invocationWith(harness, true));

    const printed = harness.out.join('');
    expect(printed).not.toContain('mneia_secret_token');
    expect(JSON.parse(printed)).toMatchObject({ signed_in: true, workspace: { slug: 'ascend' } });
  });

  it('stops on a denial rather than polling until expiry', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(400, { error: 'access_denied', error_description: 'that request was denied' }),
    ]);

    await expect(command.run(invocationWith(harness))).rejects.toMatchObject({
      exitCode: EXIT_AUTH,
    });
    expect(harness.written).toHaveLength(0);
  });

  it('stops when the request expired, and says to run login again', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, GRANT),
      jsonResponse(400, { error: 'expired_token', error_description: 'it expired' }),
    ]);

    await expect(command.run(invocationWith(harness))).rejects.toMatchObject({
      exitCode: EXIT_AUTH,
      fix: 'run mneia login again',
    });
  });

  it('reports an unreachable host as a network failure, not an auth one', async () => {
    const harness: Harness = { out: [], err: [], slept: [], written: [], requests: [] };
    const command = createLoginCommand({
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      },
      sleep: async () => {},
      now: () => 0,
      writeCredentials: async () => {},
      clientLabel: () => 'ada',
    });

    await expect(command.run(invocationWith(harness))).rejects.toMatchObject({
      exitCode: EXIT_NETWORK,
    });
  });

  it('refuses a grant that is missing the confirmation number rather than prompting for nothing', async () => {
    const { harness, command } = harnessWith([
      jsonResponse(201, { ...GRANT, confirmation_code: '' }),
    ]);

    await expect(command.run(invocationWith(harness))).rejects.toThrow(
      /did not return a device code, a user code, and a confirmation code/,
    );
  });

  it('gives up once the grant lifetime has passed', async () => {
    const harness: Harness = { out: [], err: [], slept: [], written: [], requests: [] };
    let clock = 0;
    let issued = false;
    const command = createLoginCommand({
      fetchImpl: async () => {
        if (issued) return jsonResponse(400, { error: 'authorization_pending', interval: 5 });
        issued = true;
        return jsonResponse(201, { ...GRANT, expires_in: 10 });
      },
      sleep: async () => {
        clock += 60_000;
      },
      now: () => clock,
      writeCredentials: async () => {},
      clientLabel: () => 'ada',
    });

    await expect(command.run(invocationWith(harness))).rejects.toMatchObject({
      exitCode: EXIT_AUTH,
    });
  });
});
