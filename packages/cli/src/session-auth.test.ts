import { describe, expect, it } from 'vitest';
import { CliError, type CommandIo } from './command.js';
import { createSessionPreflight } from './session-auth.js';

const identityResponse = (actor: string, workspace: string): Response =>
  new Response(
    JSON.stringify({
      actor: { id: 'a1', display_name: actor, kind: 'human' },
      workspace: { id: 'w1', slug: 'mneia', display_name: workspace },
      team: { id: 't1', display_name: 'Core' },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const unauthorized = (): Response =>
  new Response(JSON.stringify({ error: { message: 'that token has expired' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

interface Harness {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly io: CommandIo;
}

function harness(): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      cwd: '/repo',
      env: {},
    },
  };
}

const noProject = () => Promise.resolve(null);

const boundProject = () =>
  Promise.resolve({
    workspace: 'w1',
    project: 'mneia',
    endpoint: 'https://app.mneia.dev',
    configPath: '/repo/.mneia/config.json',
    repoRoot: '/repo',
  });

describe('createSessionPreflight', () => {
  it('reports the identity and project of a signed-in, bound repo', async () => {
    const h = harness();
    const preflight = createSessionPreflight({
      io: h.io,
      signIn: () => Promise.reject(new Error('should not sign in')),
      fetchImpl: () => Promise.resolve(identityResponse('Saad', 'Mneia')),
      readToken: () => Promise.resolve('token'),
      readProject: boundProject,
    });

    await expect(preflight()).resolves.toEqual({
      actor: 'Saad',
      workspace: 'Mneia',
      project: 'mneia',
    });
  });

  it('reports a null project rather than failing when the repo is unbound', async () => {
    const h = harness();
    const preflight = createSessionPreflight({
      io: h.io,
      signIn: () => Promise.reject(new Error('should not sign in')),
      fetchImpl: () => Promise.resolve(identityResponse('Saad', 'Mneia')),
      readToken: () => Promise.resolve('token'),
      readProject: noProject,
    });

    const context = await preflight();
    expect(context.project).toBeNull();
    expect(context.actor).toBe('Saad');
  });

  it('signs in when there are no credentials, then reads the identity', async () => {
    const h = harness();
    let signedIn = false;
    let calls = 0;

    const preflight = createSessionPreflight({
      io: h.io,
      signIn: () => {
        signedIn = true;
        return Promise.resolve(0);
      },
      fetchImpl: () => Promise.resolve(identityResponse('Saad', 'Mneia')),
      readToken: () => {
        calls += 1;
        if (!signedIn) {
          return Promise.reject(new CliError('auth', 'no Mneia credentials found', 'run login'));
        }
        return Promise.resolve('token');
      },
      readProject: boundProject,
    });

    const context = await preflight();
    expect(signedIn).toBe(true);
    expect(calls).toBe(2);
    expect(context.actor).toBe('Saad');
  });

  it('signs in when the stored token has expired', async () => {
    const h = harness();
    let signedIn = false;

    const preflight = createSessionPreflight({
      io: h.io,
      signIn: () => {
        signedIn = true;
        return Promise.resolve(0);
      },
      fetchImpl: () =>
        Promise.resolve(signedIn ? identityResponse('Saad', 'Mneia') : unauthorized()),
      readToken: () => Promise.resolve('token'),
      readProject: boundProject,
    });

    const context = await preflight();
    expect(signedIn).toBe(true);
    expect(context.actor).toBe('Saad');
    expect(h.stdout.join('')).toContain('expired');
  });

  it('starts the session unauthenticated when sign-in fails rather than refusing to start', async () => {
    const h = harness();
    const preflight = createSessionPreflight({
      io: h.io,
      signIn: () => Promise.resolve(4),
      fetchImpl: () => Promise.resolve(unauthorized()),
      readToken: () => Promise.resolve('token'),
      readProject: boundProject,
    });

    await expect(preflight()).resolves.toEqual({
      actor: null,
      workspace: null,
      project: 'mneia',
    });
  });

  it('does not prompt for sign-in when the network is down', async () => {
    const h = harness();
    let signInCalls = 0;

    const preflight = createSessionPreflight({
      io: h.io,
      signIn: () => {
        signInCalls += 1;
        return Promise.resolve(0);
      },
      fetchImpl: () => Promise.reject(Object.assign(new Error('down'), { code: 'ENOTFOUND' })),
      readToken: () => Promise.resolve('token'),
      readProject: boundProject,
    });

    const context = await preflight();
    expect(signInCalls).toBe(0);
    expect(context.actor).toBeNull();
    expect(context.project).toBe('mneia');
    expect(h.stderr.join('')).toContain('Starting the session anyway');
  });

  it('survives a malformed project config instead of aborting the session', async () => {
    const h = harness();
    const preflight = createSessionPreflight({
      io: h.io,
      signIn: () => Promise.reject(new Error('should not sign in')),
      fetchImpl: () => Promise.resolve(identityResponse('Saad', 'Mneia')),
      readToken: () => Promise.resolve('token'),
      readProject: () => Promise.reject(new CliError('not_configured', 'bad json', 'fix it')),
    });

    const context = await preflight();
    expect(context.project).toBeNull();
    expect(context.actor).toBe('Saad');
  });
});
