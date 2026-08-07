import { describe, expect, it } from 'vitest';
import { type CommandInvocation, EXIT_AUTH, EXIT_OK } from '../command.js';
import { createWhoamiCommand } from './whoami.js';

const AUTH_URL = 'https://app.example.test';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const IDENTITY = {
  actor: { id: 'actor-1', display_name: 'Ada Lovelace', kind: 'human' },
  workspace: { id: 'workspace-1', slug: 'ascend', display_name: 'Ascend' },
  team: { id: 'team-1', display_name: 'Default' },
};

const invocation = (out: string[], json = false): CommandInvocation => ({
  args: [],
  flags: {},
  json,
  io: {
    stdout: (text) => out.push(text),
    stderr: () => {},
    cwd: '/repo',
    env: { MNEIA_AUTH_URL: AUTH_URL },
  },
});

describe('mneia whoami', () => {
  it('reports the actor, the workspace, and the team', async () => {
    const out: string[] = [];
    const command = createWhoamiCommand({
      fetchImpl: async () => jsonResponse(200, IDENTITY),
      readToken: async () => 'mneia_token',
    });

    expect(await command.run(invocation(out))).toBe(EXIT_OK);
    const printed = out.join('');
    expect(printed).toContain('Ada Lovelace');
    expect(printed).toContain('Ascend');
    expect(printed).toContain('Default');
  });

  it('sends the token as a bearer credential', async () => {
    const out: string[] = [];
    const seen: RequestInit[] = [];
    const command = createWhoamiCommand({
      fetchImpl: async (_url, init) => {
        seen.push(init);
        return jsonResponse(200, IDENTITY);
      },
      readToken: async () => 'mneia_token',
    });

    await command.run(invocation(out));

    const headers = seen[0]?.headers as Record<string, string> | undefined;
    expect(headers?.authorization).toBe('Bearer mneia_token');
  });

  it('never prints the token back out', async () => {
    const out: string[] = [];
    const command = createWhoamiCommand({
      fetchImpl: async () => jsonResponse(200, IDENTITY),
      readToken: async () => 'mneia_secret_token',
    });

    await command.run(invocation(out));

    expect(out.join('')).not.toContain('mneia_secret_token');
  });

  it('emits machine readable identity under --json', async () => {
    const out: string[] = [];
    const command = createWhoamiCommand({
      fetchImpl: async () => jsonResponse(200, IDENTITY),
      readToken: async () => 'mneia_token',
    });

    await command.run(invocation(out, true));

    expect(JSON.parse(out.join(''))).toEqual({
      actor: { id: 'actor-1', displayName: 'Ada Lovelace', kind: 'human' },
      workspace: { id: 'workspace-1', slug: 'ascend', displayName: 'Ascend' },
      team: { id: 'team-1', displayName: 'Default' },
    });
  });

  it('tells the user to log in again when the token is refused', async () => {
    const out: string[] = [];
    const command = createWhoamiCommand({
      fetchImpl: async () =>
        jsonResponse(401, {
          error: 'invalid_token',
          error_description: 'that token is not valid',
        }),
      readToken: async () => 'stale-token',
    });

    await expect(command.run(invocation(out))).rejects.toMatchObject({
      exitCode: EXIT_AUTH,
      fix: 'run mneia login again',
    });
  });

  it('surfaces the missing-credentials error rather than calling with an empty token', async () => {
    const out: string[] = [];
    let called = false;
    const command = createWhoamiCommand({
      fetchImpl: async () => {
        called = true;
        return jsonResponse(200, IDENTITY);
      },
      readToken: async () => {
        throw Object.assign(new Error('no Mneia credentials found'), { exitCode: EXIT_AUTH });
      },
    });

    await expect(command.run(invocation(out))).rejects.toThrow('no Mneia credentials found');
    expect(called).toBe(false);
  });
});
