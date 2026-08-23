import type { ScopedStore } from '@mneia/core';
import type { ToolContext, ToolContextScope } from '@mneia/mcp-server';
import { describe, expect, it, vi } from 'vitest';
import type { UsageReport } from '../billing/usage.js';

vi.mock('server-only', () => ({}));

const shared = vi.hoisted(() => ({
  contexts: [] as ToolContextScope[],
  workspaces: [] as string[],
  report: null as UsageReport | null,
}));

const SCOPE = { workspaceId: 'workspace-1', actorId: 'actor-1' } as const;

vi.mock('../store-runtime.js', () => ({
  withWorkspaceScope: <T>(_scope: unknown, run: (store: ScopedStore) => Promise<T>): Promise<T> =>
    run({ scope: SCOPE } as ScopedStore),
}));

vi.mock('../telemetry-runtime.js', () => ({ telemetry: () => ({ emit: async () => {} }) }));

vi.mock('../billing/usage-store.js', () => ({
  loadUsageReport: async (workspaceId: string) => {
    shared.workspaces.push(workspaceId);
    return shared.report;
  },
}));

vi.mock('@mneia/mcp-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mneia/mcp-server')>()),
  createMneiaServer: (options: { context: ToolContextScope }) => {
    shared.contexts.push(options.context);
    return { shutdown: async () => {} };
  },
}));

import { clientFromUserAgent, createRemoteMcpSession } from './runtime.js';

// Stateless Streamable HTTP answers every request with a fresh server, so the clientInfo sent on
// initialize never reaches the tools/call that follows. The User-Agent is the only identity that
// travels on each request, and an unattributed write is a session row docs/CLIENTS.md cannot cite.
describe('clientFromUserAgent', () => {
  it('splits the conventional name/version form', () => {
    expect(clientFromUserAgent('mneia-mcp/0.12.0')).toEqual({
      name: 'mneia-mcp',
      version: '0.12.0',
    });
  });

  it('keeps a path-like client name intact and takes only the last slash as the separator', () => {
    expect(clientFromUserAgent('modelcontextprotocol/sdk/1.30.0')).toEqual({
      name: 'modelcontextprotocol/sdk',
      version: '1.30.0',
    });
  });

  it('ignores everything after the first token, which is where comments live', () => {
    expect(clientFromUserAgent('claude-code/2.1.239 (macOS; arm64)')).toEqual({
      name: 'claude-code',
      version: '2.1.239',
    });
  });

  it('keeps an unversioned agent whole rather than inventing a split', () => {
    expect(clientFromUserAgent('Cursor')).toEqual({ name: 'Cursor', version: 'unknown' });
  });

  it('does not treat a trailing slash as a version', () => {
    expect(clientFromUserAgent('weird/')).toEqual({ name: 'weird/', version: 'unknown' });
  });

  it('does not treat a leading slash as a name', () => {
    expect(clientFromUserAgent('/1.2.3')).toEqual({ name: '/1.2.3', version: 'unknown' });
  });

  it('returns nothing when the header is absent or blank, so the caller keeps MCP clientInfo', () => {
    expect(clientFromUserAgent(null)).toBeUndefined();
    expect(clientFromUserAgent('   ')).toBeUndefined();
  });

  it('bounds the name so a hostile User-Agent cannot write an unbounded client_name', () => {
    const parsed = clientFromUserAgent('x'.repeat(500));
    expect(parsed?.name).toHaveLength(120);
  });
});

const identity = {
  workspaceId: SCOPE.workspaceId,
  actorId: SCOPE.actorId,
  tokenId: 'token-1',
  workspaceName: 'Mneia',
  workspaceSlug: 'mneia',
  actorName: 'Agent',
  actorKind: 'agent',
  teamId: 'team-1',
  teamName: 'Core',
};

const REPORT: UsageReport = {
  plan: 'pro',
  periodStart: '2026-08-01T00:00:00.000Z',
  periodEnd: '2026-09-01T00:00:00.000Z',
  turns: { used: 1_000, allowance: 272_000, fraction: 1_000 / 272_000 },
  extractions: { used: 850, allowance: 1_700, fraction: 0.5 },
  embeddingTokens: { used: 90, allowance: 2_720_000, fraction: 0.0001 },
  checkpoints: 42,
  percentUsed: 50,
  warn: false,
};

const toolContextOf = async (): Promise<ToolContext> => {
  shared.contexts.length = 0;
  shared.workspaces.length = 0;
  createRemoteMcpSession(identity);
  const scope = shared.contexts[0];
  if (scope === undefined) {
    throw new Error('expected createRemoteMcpSession to hand createMneiaServer a context scope');
  }
  return scope(async (context) => context);
};

// The hosted runtime is the one real agents talk to. Every test of the three tools that report
// usage injects its own probe, so a runtime that supplied none would answer usage: null in
// production with the whole suite green — which is the failure this describe block exists for.
describe('the hosted MCP runtime supplies a usage probe', () => {
  it('hands the tools a probe rather than leaving it undefined', async () => {
    shared.report = REPORT;

    expect((await toolContextOf()).usage).toBeTypeOf('function');
  });

  it('meters the workspace the bearer token resolved to', async () => {
    shared.report = REPORT;
    const context = await toolContextOf();

    await context.usage?.();

    expect(shared.workspaces).toEqual([SCOPE.workspaceId]);
  });

  it('reports the meter without the embedding dial, which no customer surface may show', async () => {
    shared.report = REPORT;
    const context = await toolContextOf();

    await expect(context.usage?.()).resolves.toEqual({
      plan: 'pro',
      periodStart: '2026-08-01T00:00:00.000Z',
      periodEnd: '2026-09-01T00:00:00.000Z',
      turns: REPORT.turns,
      extractions: REPORT.extractions,
      checkpoints: 42,
      percentUsed: 50,
      warn: false,
    });
  });

  // null means "this server does not report usage", which is never the same claim as a report
  // of zeros. A workspace with no row to meter must not be rendered as an unused allowance.
  it('resolves null when the workspace has no row to meter', async () => {
    shared.report = null;
    const context = await toolContextOf();

    await expect(context.usage?.()).resolves.toBeNull();
  });
});
