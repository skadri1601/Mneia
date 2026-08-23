import { describe, expect, it, vi } from 'vitest';
import type { CommandIo } from '../command.js';
import { CliError, EXIT_FAILED, EXIT_OK } from '../command.js';
import { createMcpCommand, type McpConfigApi } from './mcp.js';

const io = (): { value: CommandIo; output: string[] } => {
  const output: string[] = [];
  return {
    output,
    value: {
      stdout: (text) => output.push(text),
      stderr: (text) => output.push(text),
      cwd: '/repo',
      env: {},
    },
  };
};

const installed = (client: 'codex' | 'cursor', command = 'mneia-mcp') => ({
  agentType: client,
  displayName: client,
  detected: true,
  scope: 'global' as const,
  configPath: `/tmp/${client}.config`,
  servers: [
    {
      serverName: 'mneia',
      config: { command, args: [], env: {} },
      identity: `${command}:`,
      agentType: client,
      scope: 'global' as const,
      configPath: `/tmp/${client}.config`,
    },
  ],
});

const configApi = (servers: readonly ReturnType<typeof installed>[] = []): McpConfigApi => ({
  supportedClients: () => ['codex', 'cursor'],
  detectClients: vi.fn().mockResolvedValue(['codex']),
  list: vi.fn().mockResolvedValue(servers),
  upsert: vi.fn().mockReturnValue({ success: true, path: '/tmp/config.toml' }),
  remove: vi.fn().mockReturnValue({ success: true, path: '/tmp/config.toml', removed: true }),
});

const run = async (
  command: ReturnType<typeof createMcpCommand>,
  args: readonly string[],
  flags: Readonly<Record<string, string | boolean>> = {},
  json = false,
) => {
  const target = io();
  const code = await command.run({ args, flags, json, io: target.value });
  return { code, output: target.output.join('') };
};

const failure = async (
  command: ReturnType<typeof createMcpCommand>,
  args: readonly string[],
  flags: Readonly<Record<string, string | boolean>> = {},
) => {
  try {
    await run(command, args, flags);
  } catch (error) {
    if (error instanceof CliError) return error;
    throw error;
  }
  throw new Error('expected mneia mcp to fail');
};

describe('mneia mcp', () => {
  it('installs the canonical MNEIA server for an explicit client', async () => {
    const config = configApi();
    const command = createMcpCommand({ config });
    const target = io();

    const code = await command.run({
      args: ['install'],
      flags: { client: 'codex', yes: true },
      json: false,
      io: target.value,
    });

    expect(code).toBe(EXIT_OK);
    expect(config.upsert).toHaveBeenCalledWith('codex', 'mneia', {
      command: 'mneia-mcp',
      args: [],
      env: {},
    });
  });

  it('reports an identical install as unchanged without rewriting it', async () => {
    const config = configApi([installed('codex')]);
    const result = await run(createMcpCommand({ config }), ['install'], { client: 'codex' }, true);

    expect(result.code).toBe(EXIT_OK);
    expect(config.upsert).not.toHaveBeenCalled();
    expect(JSON.parse(result.output)).toMatchObject({
      ok: true,
      changed: [],
      unchanged: ['codex'],
      failed: [],
    });
  });

  it('requires --yes before replacing a different mneia entry', async () => {
    const config = configApi([installed('codex', 'different-command')]);
    const error = await failure(createMcpCommand({ config }), ['install'], { client: 'codex' });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('--yes');
    expect(config.upsert).not.toHaveBeenCalled();
  });

  it('lists only MNEIA registrations as machine-readable output', async () => {
    const config = configApi([installed('codex')]);
    const result = await run(createMcpCommand({ config }), ['list'], { client: 'codex' }, true);

    expect(result.code).toBe(EXIT_OK);
    expect(JSON.parse(result.output)).toMatchObject({
      ok: true,
      installed: [{ client: 'codex', configPath: '/tmp/codex.config' }],
      failed: [],
    });
  });

  it('uninstalls MNEIA without touching other server names', async () => {
    const config = configApi([installed('cursor')]);
    const result = await run(createMcpCommand({ config }), ['uninstall'], {
      client: 'cursor',
      yes: true,
    });

    expect(result.code).toBe(EXIT_OK);
    expect(config.remove).toHaveBeenCalledWith('cursor', 'mneia');
  });

  it('returns a failed exit when one requested client cannot be configured', async () => {
    const config = configApi();
    vi.mocked(config.upsert)
      .mockReturnValueOnce({ success: true, path: '/tmp/codex.toml' })
      .mockReturnValueOnce({ success: false, path: '/tmp/cursor.json', error: 'read only' });

    const result = await run(
      createMcpCommand({ config }),
      ['install'],
      { all: true, yes: true },
      true,
    );

    expect(result.code).toBe(EXIT_FAILED);
    expect(JSON.parse(result.output)).toMatchObject({
      changed: ['codex'],
      unchanged: [],
      failed: [{ client: 'cursor', error: 'read only' }],
    });
  });

  it('rejects unknown clients with the supported values', async () => {
    const error = await failure(createMcpCommand({ config: configApi() }), ['install'], {
      client: 'warp',
    });

    expect(error.message).toContain('warp');
    expect(error.fix).toContain('codex');
    expect(error.fix).toContain('cursor');
  });

  it('rejects --client with --all', async () => {
    const error = await failure(createMcpCommand({ config: configApi() }), ['install'], {
      client: 'codex',
      all: true,
    });

    expect(error.kind).toBe('usage');
    expect(error.message).toContain('cannot be used together');
  });

  it('points to --client when no supported client is detected', async () => {
    const config = configApi();
    vi.mocked(config.detectClients).mockResolvedValue([]);
    const error = await failure(createMcpCommand({ config }), ['install']);

    expect(error.kind).toBe('not_configured');
    expect(error.fix).toContain('--client');
  });

  it('rejects extra positionals and --yes on list', async () => {
    const command = createMcpCommand({ config: configApi() });
    expect((await failure(command, ['install', 'codex'])).kind).toBe('usage');
    expect((await failure(command, ['list'], { yes: true })).message).toContain('--yes');
  });
});
