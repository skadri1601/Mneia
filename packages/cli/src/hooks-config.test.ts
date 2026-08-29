import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError } from './command.js';
import {
  detectHookRuntime,
  HOOK_CLIENT_SPECS,
  HOOK_DEADLINE_SECONDS,
  HOOK_TIMEOUT_SECONDS,
  type HookRuntime,
  hookCommandFor,
  installSessionStartHook,
  installStopHook,
  MIN_HOOK_DEADLINE_HEADROOM_SECONDS,
  STOP_HOOK_TIMEOUT_SECONDS,
} from './hooks-config.js';

const repo = () => mkdtemp(join(tmpdir(), 'mneia-hooks-'));

const INSTALLED: HookRuntime = { ephemeral: false, version: '9.9.9' };
const EPHEMERAL: HookRuntime = { ephemeral: true, version: '9.9.9' };

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8'));

describe('installSessionStartHook', () => {
  it('creates the config for each client under its own event name', async () => {
    const root = await repo();

    for (const client of ['claude-code', 'codex', 'cursor'] as const) {
      const outcome = await installSessionStartHook(root, client, INSTALLED);
      expect(outcome.result).toBe('created');

      const spec = HOOK_CLIENT_SPECS[client];
      const config = await readJson(join(root, spec.configPath));
      const hooks = config.hooks as Record<string, unknown>;
      expect(JSON.stringify(hooks[spec.event])).toContain(hookCommandFor(client, INSTALLED));
    }
  });

  it('is idempotent — a second run changes nothing and does not add a duplicate', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'claude-code', INSTALLED);
    const again = await installSessionStartHook(root, 'claude-code', INSTALLED);

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

    await installSessionStartHook(root, 'claude-code', INSTALLED);
    const config = await readJson(path);

    expect(config.permissions).toEqual({ allow: ['Bash(git status)'] });
    expect(config.env).toEqual({ MNEIA_ENDPOINT: 'https://example.test' });

    const hooks = config.hooks as Record<string, unknown>;
    expect(JSON.stringify(hooks.PreToolUse)).toContain('node guard.mjs');

    const sessionStart = hooks.SessionStart as unknown[];
    expect(sessionStart).toHaveLength(2);
    expect(JSON.stringify(sessionStart[0])).toContain('node other-tool.mjs');
    expect(JSON.stringify(sessionStart[1])).toContain(hookCommandFor('claude-code', INSTALLED));
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

    const outcome = await installSessionStartHook(root, 'cursor', INSTALLED);
    expect(outcome.result).toBe('updated');

    const entries = ((await readJson(path)).hooks as Record<string, unknown>)
      .sessionStart as unknown[];
    expect(entries).toHaveLength(1);
  });

  it('sets the Cursor schema version, which Cursor requires and defaults nowhere', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'cursor', INSTALLED);
    expect((await readJson(join(root, '.cursor', 'hooks.json'))).version).toBe(1);
  });

  it('raises the Codex context limit above the slice budget it would otherwise truncate', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'codex', INSTALLED);

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

    await expect(installSessionStartHook(root, 'claude-code', INSTALLED)).rejects.toBeInstanceOf(
      CliError,
    );
  });

  it('persists a pinned npx invocation when the running CLI will not outlive this process', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'claude-code', EPHEMERAL);

    const config = await readJson(join(root, '.claude', 'settings.json'));
    const written = JSON.stringify((config.hooks as Record<string, unknown>).SessionStart);

    expect(written).toContain('npx -y @mneia/cli@9.9.9 hook session-start --client claude-code');
  });

  it('recognises its own npx entry on a re-run, instead of installing the hook twice', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'cursor', EPHEMERAL);
    const again = await installSessionStartHook(root, 'cursor', EPHEMERAL);
    expect(again.result).toBe('unchanged');

    const upgraded = await installSessionStartHook(root, 'cursor', INSTALLED);
    expect(upgraded.result).toBe('updated');

    const config = await readJson(join(root, '.cursor', 'hooks.json'));
    const entries = (config.hooks as Record<string, unknown>).sessionStart as unknown[];
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries[0])).toContain('mneia hook session-start --client cursor');
  });
});

describe('detectHookRuntime', () => {
  it('reads the npm _npx cache as ephemeral, on either path separator', () => {
    expect(
      detectHookRuntime('/home/dev/.npm/_npx/8f1c/node_modules/@mneia/cli/dist/bin.js', '1.2.3')
        .ephemeral,
    ).toBe(true);
    expect(
      detectHookRuntime(
        String.raw`C:\Users\dev\AppData\Local\npm-cache\_npx\8f1c\node_modules\@mneia\cli\dist\bin.js`,
        '1.2.3',
      ).ephemeral,
    ).toBe(true);
  });

  it('reads a real install as permanent, and keeps the version it was told', () => {
    const runtime = detectHookRuntime(
      '/usr/local/lib/node_modules/@mneia/cli/dist/bin.js',
      '1.2.3',
    );
    expect(runtime).toEqual({ ephemeral: false, version: '1.2.3' });
    expect(hookCommandFor('codex', runtime)).toBe('mneia hook session-start --client codex');
  });

  it('falls back to the npm environment when the bin path is not available', () => {
    expect(
      detectHookRuntime(undefined, '1.2.3', {
        npm_config_local_prefix: '/home/dev/.npm/_npx/8f1c',
      }).ephemeral,
    ).toBe(true);
    expect(detectHookRuntime(undefined, '1.2.3').ephemeral).toBe(false);
  });
});

describe('GUARD the internal deadline stays below the harness timeout', () => {
  it('leaves the hook enough headroom to write the unavailable-memory note', () => {
    expect(HOOK_DEADLINE_SECONDS).toBeLessThan(HOOK_TIMEOUT_SECONDS);
    expect(HOOK_TIMEOUT_SECONDS - HOOK_DEADLINE_SECONDS).toBeGreaterThanOrEqual(
      MIN_HOOK_DEADLINE_HEADROOM_SECONDS,
    );
    expect(MIN_HOOK_DEADLINE_HEADROOM_SECONDS).toBeGreaterThan(0);
  });

  it('advertises the harness timeout, not the internal one, to the client', async () => {
    const root = await repo();
    await installSessionStartHook(root, 'claude-code', INSTALLED);

    const entries = (
      (await readJson(join(root, '.claude', 'settings.json'))).hooks as Record<string, unknown>
    ).SessionStart as { hooks: { timeout?: number }[] }[];

    expect(entries[0]?.hooks[0]?.timeout).toBe(HOOK_TIMEOUT_SECONDS);
  });
});

describe('the end-of-turn checkpoint hook', () => {
  const permanent: HookRuntime = { ephemeral: false, version: '9.9.9' };

  const repo = async (): Promise<string> => mkdtemp(join(tmpdir(), 'mneia-stop-'));

  it('installs a Stop entry for Claude Code, because reading without writing drains the store', async () => {
    const root = await repo();

    const outcome = await installStopHook(root, 'claude-code', permanent);

    expect(outcome).not.toBeNull();
    expect(outcome?.event).toBe('stop');
    const written = JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8'));
    const entry = written.hooks.Stop[0].hooks[0];
    expect(entry.command).toBe('mneia hook stop --client claude-code');
    expect(entry.timeout).toBe(STOP_HOOK_TIMEOUT_SECONDS);
  });

  it('installs nothing for a client with no verified end-of-turn event', async () => {
    const root = await repo();

    expect(await installStopHook(root, 'codex', permanent)).toBeNull();
    expect(await installStopHook(root, 'cursor', permanent)).toBeNull();
  });

  it('keeps the two events apart, so installing one never overwrites the other', async () => {
    const root = await repo();

    await installSessionStartHook(root, 'claude-code', permanent);
    await installStopHook(root, 'claude-code', permanent);

    const written = JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(written.hooks.SessionStart[0].hooks[0].command).toContain('hook session-start');
    expect(written.hooks.Stop[0].hooks[0].command).toContain('hook stop');
  });

  it('is idempotent, so init twice does not checkpoint twice and bill for it', async () => {
    const root = await repo();

    await installStopHook(root, 'claude-code', permanent);
    const again = await installStopHook(root, 'claude-code', permanent);

    expect(again?.result).toBe('unchanged');
    const written = JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(written.hooks.Stop).toHaveLength(1);
  });

  it('pins the npx form for an ephemeral install, exactly as session-start does', async () => {
    const root = await repo();

    await installStopHook(root, 'claude-code', { ephemeral: true, version: '0.19.0' });

    const written = JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(written.hooks.Stop[0].hooks[0].command).toBe(
      'npx -y @mneia/cli@0.19.0 hook stop --client claude-code',
    );
  });

  it('leaves a foreign Stop hook in place', async () => {
    const root = await repo();
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'make tidy' }] }] } }),
      'utf8',
    );

    await installStopHook(root, 'claude-code', permanent);

    const written = JSON.parse(await readFile(join(root, '.claude', 'settings.json'), 'utf8'));
    expect(written.hooks.Stop).toHaveLength(2);
    expect(written.hooks.Stop[0].hooks[0].command).toBe('make tidy');
  });
});
