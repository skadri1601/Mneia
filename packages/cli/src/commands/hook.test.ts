import type { Slice } from '@mneia/core';
import { describe, expect, it, vi } from 'vitest';
import { CliError, type CommandInvocation } from '../command.js';
import { HOOK_DEADLINE_SECONDS, HOOK_TIMEOUT_SECONDS } from '../hooks-config.js';
import { createHookCommand, type HookDeps } from './hook.js';

const slice = (overrides: Partial<Slice> = {}): Slice =>
  ({
    id: 'slice-1',
    projectId: 'project-1',
    task: 'continuing work on branch feat/x',
    generatedAt: new Date('2026-08-23T00:00:00.000Z'),
    tokenBudget: 4000,
    tokensUsed: 120,
    renderedMarkdown: '## Constraints\n- Never log user content',
    items: [{ item: { loadBearing: true } }],
    ...overrides,
  }) as unknown as Slice;

function invokeStop(deps: Partial<HookDeps>, payload: unknown) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const command = createHookCommand({
    api: { rehydrate: async () => slice() },
    loadConfig: () => ({ endpoint: 'https://api.test' }) as never,
    readStdin: async () => JSON.stringify(payload),
    branchOf: async () => 'feat/x',
    ...deps,
  });

  const invocation: CommandInvocation = {
    args: ['stop'],
    flags: { client: 'claude-code' },
    json: false,
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      cwd: '/repo',
      env: {},
    },
  };

  return { command, invocation, stdout, stderr };
}

function invoke(deps: Partial<HookDeps>, flags: Record<string, string | boolean> = {}) {
  const written: string[] = [];
  const command = createHookCommand({
    api: { rehydrate: async () => slice() },
    loadConfig: () => ({ endpoint: 'https://api.test' }) as never,
    readStdin: async () => '{}',
    branchOf: async () => 'feat/mne-79-hooks',
    ...deps,
  });

  const invocation: CommandInvocation = {
    args: ['session-start'],
    flags: { client: 'claude-code', ...flags },
    json: false,
    io: {
      stdout: (text) => written.push(text),
      stderr: () => {},
      cwd: '/repo',
      env: {},
    },
  };

  return { command, invocation, written };
}

describe('mneia hook session-start', () => {
  it('wraps the slice in the Claude Code and Codex envelope', async () => {
    const { command, invocation, written } = invoke({});
    expect(await command.run(invocation)).toBe(0);

    const payload = JSON.parse(written.join(''));
    expect(payload.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(payload.hookSpecificOutput.additionalContext).toContain('Never log user content');
  });

  it('wraps the slice in Cursor’s flat, snake-cased envelope instead', async () => {
    const { command, invocation, written } = invoke({}, { client: 'cursor' });
    await command.run(invocation);

    const payload = JSON.parse(written.join(''));
    expect(payload.additional_context).toContain('Never log user content');
    expect(payload.hookSpecificOutput).toBeUndefined();
  });

  it('reads the working directory from Cursor’s workspace_roots, not just cwd', async () => {
    let seen = '';
    const { command, invocation } = invoke(
      {
        readStdin: async () => JSON.stringify({ workspace_roots: ['/from/cursor'] }),
        loadConfig: (cwd) => {
          seen = cwd;
          return { endpoint: 'https://api.test' } as never;
        },
      },
      { client: 'cursor' },
    );
    await command.run(invocation);
    expect(seen).toBe('/from/cursor');
  });

  it('still exits 0 and says so when rehydration fails, rather than blocking the session', async () => {
    const { command, invocation, written } = invoke({
      api: {
        rehydrate: async () => {
          throw new CliError('network', 'could not reach the Mneia API', 'check your connection');
        },
      },
    });

    expect(await command.run(invocation)).toBe(0);
    const context = JSON.parse(written.join('')).hookSpecificOutput.additionalContext;
    expect(context).toContain('unavailable');
    expect(context).toContain('could not reach the Mneia API');
    expect(context).toContain('do not assume');
  });

  it('exits 0 when the repo is not bound, because an unbound repo is not an error here', async () => {
    const { command, invocation, written } = invoke({
      loadConfig: () => {
        throw new CliError('not_configured', 'no .mneia/config', 'run mneia init');
      },
    });

    expect(await command.run(invocation)).toBe(0);
    expect(written.join('')).toContain('unavailable');
  });

  it('survives a payload that is not JSON at all', async () => {
    const { command, invocation, written } = invoke({ readStdin: async () => 'not json' });
    expect(await command.run(invocation)).toBe(0);
    expect(written.join('')).toContain('Never log user content');
  });

  it('tells the agent the project is empty rather than pretending it rehydrated', async () => {
    const { command, invocation, written } = invoke({
      api: { rehydrate: async () => slice({ renderedMarkdown: '', items: [] }) },
    });
    await command.run(invocation);
    expect(written.join('')).toContain('empty');
  });

  it('gives up at its own deadline, leaving the harness time to read the note it writes', async () => {
    vi.useFakeTimers();
    try {
      const { command, invocation, written } = invoke({
        api: { rehydrate: () => new Promise(() => undefined) },
      });
      const run = command.run(invocation);
      await vi.advanceTimersByTimeAsync(HOOK_DEADLINE_SECONDS * 1000);

      expect(await run).toBe(0);
      const context = JSON.parse(written.join('')).hookSpecificOutput.additionalContext;
      expect(context).toContain('unavailable');
      expect(context).toContain(`${HOOK_DEADLINE_SECONDS}s`);
      expect(HOOK_DEADLINE_SECONDS).toBeLessThan(HOOK_TIMEOUT_SECONDS);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects an unknown client instead of writing an envelope nothing reads', async () => {
    const { command, invocation } = invoke({}, { client: 'windsurf' });
    await expect(command.run(invocation)).rejects.toBeInstanceOf(CliError);
  });

  it('rejects an unknown event', async () => {
    const { command, invocation } = invoke({});
    await expect(command.run({ ...invocation, args: ['session-end'] })).rejects.toBeInstanceOf(
      CliError,
    );
  });
});

describe('mneia hook stop', () => {
  it('checkpoints the session the harness names, not every session in the directory', async () => {
    const checkpoint = vi.fn(async () => {});
    const { command, invocation } = invokeStop(
      { checkpoint },
      { cwd: '/work/repo', session_id: 'sess-abc' },
    );

    expect(await command.run(invocation)).toBe(0);
    expect(checkpoint).toHaveBeenCalledWith({
      cwd: '/work/repo',
      env: {},
      client: 'claude-code',
      sessionRef: 'sess-abc',
    });
  });

  it('refuses to recurse when the turn was itself continued by a stop hook', async () => {
    const checkpoint = vi.fn(async () => {});
    const { command, invocation } = invokeStop(
      { checkpoint },
      { cwd: '/work/repo', session_id: 'sess-abc', stop_hook_active: true },
    );

    expect(await command.run(invocation)).toBe(0);
    // Each checkpoint is a paid extraction, so this guard is the difference between a
    // hook and a billing loop.
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('falls back to no session ref when the harness names none', async () => {
    const checkpoint = vi.fn(async () => {});
    const { command, invocation } = invokeStop({ checkpoint }, { cwd: '/work/repo' });

    await command.run(invocation);
    expect(checkpoint).toHaveBeenCalledWith(
      expect.objectContaining({ sessionRef: null, cwd: '/work/repo' }),
    );
  });

  it('writes nothing to stdout, because a Stop hook stdout is read as a directive', async () => {
    const { command, invocation, stdout } = invokeStop(
      { checkpoint: async () => {} },
      { cwd: '/work/repo' },
    );

    await command.run(invocation);
    expect(stdout).toEqual([]);
  });

  it('never fails the harness when the checkpoint throws', async () => {
    const { command, invocation, stderr } = invokeStop(
      {
        checkpoint: async () => {
          throw new Error('the API is down');
        },
      },
      { cwd: '/work/repo' },
    );

    expect(await command.run(invocation)).toBe(0);
    expect(stderr.join(' ')).toContain('the API is down');
  });

  it('rejects an event that is neither session-start nor stop', async () => {
    const { command, invocation } = invokeStop({ checkpoint: async () => {} }, {});
    const bad = { ...invocation, args: ['compact'] };

    await expect(command.run(bad)).rejects.toBeInstanceOf(CliError);
  });
});
