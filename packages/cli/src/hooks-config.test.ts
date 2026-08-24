import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError } from './command.js';
import { HOOK_CLIENT_SPECS, hookCommandFor, installSessionStartHook } from './hooks-config.js';

const repo = () => mkdtemp(join(tmpdir(), 'mneia-hooks-'));

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8'));

describe('installSessionStartHook', () => {
  it('creates the config for each client under its own event name', async () => {
    const root = await repo();

    for (const client of ['claude-code', 'codex', 'cursor'] as const) {
      const outcome = await installSessionStartHook(root, client);
      expect(outcome.result).toBe('created');

      const spec = HOOK_CLIENT_SPECS[client];
      const config = await readJson(join(root, spec.configPath));
      const hooks = config.hooks as Record<string, unknown>;
      expect(JSON.stringify(hooks[spec.event])).toContain(hookCommandFor(client));
    }
  });

  it('is idempotent — a second run changes nothing and does not add a duplicate', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'claude-code');
    const again = await installSessionStartHook(root, 'claude-code');

    expect(again.result).toBe('unchanged');

    const config = await readJson(join(root, HOOK_CLIENT_SPECS['claude-code'].configPath));
    const entries = (config.hooks as Record<string, unknown>).SessionStart;
    expect(Array.isArray(entries) && entries.length).toBe(1);
  });

  it('preserves permissions, env, and every foreign hook already in the file', async () => {
    const root = await repo();
    const path = join(root, '.claude', 'settings.json');
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        permissions: { allow: ['Bash(git status)'] },
        env: { MNEIA_ENDPOINT: 'https://example.test' },
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'node other-tool.mjs' }] }],
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'node guard.mjs' }] },
          ],
        },
      }),
      'utf8',
    );

    await installSessionStartHook(root, 'claude-code');
    const config = await readJson(path);

    expect(config.permissions).toEqual({ allow: ['Bash(git status)'] });
    expect(config.env).toEqual({ MNEIA_ENDPOINT: 'https://example.test' });

    const hooks = config.hooks as Record<string, unknown>;
    expect(JSON.stringify(hooks.PreToolUse)).toContain('node guard.mjs');

    const sessionStart = hooks.SessionStart as unknown[];
    expect(sessionStart).toHaveLength(2);
    expect(JSON.stringify(sessionStart[0])).toContain('node other-tool.mjs');
    expect(JSON.stringify(sessionStart[1])).toContain(hookCommandFor('claude-code'));
  });

  it('replaces an edited mneia entry in place rather than beside it', async () => {
    const root = await repo();
    const path = join(root, '.cursor', 'hooks.json');
    await mkdir(join(root, '.cursor'), { recursive: true });
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        hooks: { sessionStart: [{ command: '/opt/bin/mneia hook session-start --client cursor' }] },
      }),
      'utf8',
    );

    const outcome = await installSessionStartHook(root, 'cursor');
    expect(outcome.result).toBe('updated');

    const entries = ((await readJson(path)).hooks as Record<string, unknown>)
      .sessionStart as unknown[];
    expect(entries).toHaveLength(1);
  });

  it('sets the Cursor schema version, which Cursor requires and defaults nowhere', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'cursor');
    expect((await readJson(join(root, '.cursor', 'hooks.json'))).version).toBe(1);
  });

  it('raises the Codex context limit above the slice budget it would otherwise truncate', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'codex');

    const entries = (
      (await readJson(join(root, '.codex', 'hooks.json'))).hooks as Record<string, unknown>
    ).SessionStart as { hooks: { additionalContextLimit?: number }[] }[];

    const limit = entries[0]?.hooks[0]?.additionalContextLimit ?? 0;
    expect(limit).toBeGreaterThan(4000);
  });

  it('refuses to write over a config it cannot parse, rather than discarding it', async () => {
    const root = await repo();
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(join(root, '.claude', 'settings.json'), '{ not json', 'utf8');

    await expect(installSessionStartHook(root, 'claude-code')).rejects.toBeInstanceOf(CliError);
  });
});
