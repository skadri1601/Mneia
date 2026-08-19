import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ScopedStore, TelemetryEmitter } from '@mneia/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import type { ErasedToolDefinition } from './registry.js';
import { ToolRegistry } from './registry.js';
import type { MneiaServer, ToolContextScope } from './server.js';
import {
  createMneiaServer,
  redirectConsoleToStderr,
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  ToolAdvertisementError,
} from './server.js';
import { createToolContextFixture } from './tools/context-fixture.js';
import type { ToolContext, ToolResult } from './tools/types.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-08-01T12:00:00.000Z');

function unreachable(method: string): () => Promise<never> {
  return () => Promise.reject(new Error(`${method} must not be called by the server scaffold`));
}

const STORE: ScopedStore = {
  scope: { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
  getActor: unreachable('getActor'),
  getProjectBySlug: unreachable('getProjectBySlug'),
  getProject: unreachable('getProject'),
  createSession: unreachable('createSession'),
  endSession: unreachable('endSession'),
  getContextItem: unreachable('getContextItem'),
  listContextItems: unreachable('listContextItems'),
  searchContextItems: unreachable('searchContextItems'),
  insertContextItem: unreachable('insertContextItem'),
  supersedeContextItem: unreachable('supersedeContextItem'),
  writeCheckpoint: unreachable('writeCheckpoint'),
  getCheckpoint: unreachable('getCheckpoint'),
  listCheckpoints: unreachable('listCheckpoints'),
  createHandoff: unreachable('createHandoff'),
  receiveHandoff: unreachable('receiveHandoff'),
  getHandoff: unreachable('getHandoff'),
  recordConflict: unreachable('recordConflict'),
  listOpenConflicts: unreachable('listOpenConflicts'),
  resolveConflict: unreachable('resolveConflict'),
};

const SILENT_TELEMETRY: TelemetryEmitter = {
  emit: () => Promise.resolve(),
  flush: () => Promise.resolve(),
  close: () => Promise.resolve(),
};

const CONTEXT: ToolContext = createToolContextFixture(STORE, SILENT_TELEMETRY, { now: NOW });

const SCOPE: ToolContextScope = (run) => run(CONTEXT);

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let capture: ((value: T) => void) | null = null;
  const promise = new Promise<T>((resolve) => {
    capture = resolve;
  });
  if (capture === null) {
    throw new Error('the promise executor did not run synchronously');
  }
  return { promise, resolve: capture };
}

function stubTool(
  name: string,
  run?: (input: unknown, context: ToolContext) => Promise<ToolResult>,
): ErasedToolDefinition {
  return {
    name,
    title: `Stub ${name}`,
    description: `Stub definition for ${name}.`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    parse: (raw) => raw,
    run: run ?? (() => Promise.resolve({ content: [{ type: 'text', text: `${name} ran` }] })),
  };
}

interface HarnessOptions {
  readonly context?: ToolContextScope | undefined;
  readonly telemetry?: TelemetryEmitter | undefined;
  readonly closeStore?: (() => Promise<void>) | undefined;
  readonly version?: string | undefined;
  readonly shutdownTimeoutMs?: number | undefined;
  readonly onWarn?: ((message: string) => void) | undefined;
  readonly onClientInfo?:
    | ((client: { readonly name: string; readonly version: string }) => void)
    | undefined;
}

function serverWith(
  tools: readonly ErasedToolDefinition[],
  options: HarnessOptions = {},
): MneiaServer {
  return createMneiaServer({
    registry: new ToolRegistry(tools),
    context: options.context ?? SCOPE,
    telemetry: options.telemetry,
    closeStore: options.closeStore,
    version: options.version,
    shutdownTimeoutMs: options.shutdownTimeoutMs,
    logger: {
      info: () => undefined,
      warn: options.onWarn ?? (() => undefined),
      error: () => undefined,
    },
    onClientInfo: options.onClientInfo,
  });
}

async function connectClient(mneia: MneiaServer): Promise<Client> {
  const client = new Client({ name: 'mneia-test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([mneia.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function firstText(result: unknown): string {
  if (typeof result !== 'object' || result === null) {
    throw new Error('the tool call returned no result object');
  }
  const content: unknown = Reflect.get(result, 'content');
  if (!Array.isArray(content)) {
    throw new Error('the tool call result has no content array');
  }
  const [block] = content;
  if (typeof block !== 'object' || block === null) {
    throw new Error('the tool call returned no content block');
  }
  const text: unknown = Reflect.get(block, 'text');
  if (typeof text !== 'string') {
    throw new Error('the first content block is not text');
  }
  return text;
}

describe('createMneiaServer tool advertisement', () => {
  it('captures client identity from the initialization handshake', async () => {
    const clients: { readonly name: string; readonly version: string }[] = [];
    const mneia = serverWith([stubTool('mneia_rehydrate')], {
      onClientInfo: (client) => clients.push(client),
    });
    const client = await connectClient(mneia);

    expect(clients).toEqual([{ name: 'mneia-test-client', version: '0.0.0' }]);

    await client.close();
  });
  it('advertises exactly the registry surface, with title, description, and schema', async () => {
    const mneia = serverWith([stubTool('mneia_rehydrate'), stubTool('mneia_assert')]);
    const client = await connectClient(mneia);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name)).toEqual(['mneia_rehydrate', 'mneia_assert']);
    expect(tools[0]?.title).toBe('Stub mneia_rehydrate');
    expect(tools[0]?.description).toBe('Stub definition for mneia_rehydrate.');
    expect(tools[0]?.inputSchema.type).toBe('object');

    await mneia.shutdown();
  });

  it('reports its own name, version, and usage instructions to the client', async () => {
    const mneia = serverWith([stubTool('mneia_rehydrate')], { version: '1.2.3' });
    const client = await connectClient(mneia);

    expect(client.getServerVersion()).toMatchObject({ name: SERVER_NAME, version: '1.2.3' });
    expect(client.getInstructions()).toContain('mneia_rehydrate');

    await mneia.shutdown();
  });

  it('tells a client with no hook support to rehydrate at session start and checkpoint at a task boundary', async () => {
    const mneia = serverWith([stubTool('mneia_rehydrate')]);
    const client = await connectClient(mneia);
    const instructions = client.getInstructions() ?? '';

    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(instructions).toMatch(/mneia_rehydrate once at the start of a session/);
    expect(instructions).toMatch(/mneia_checkpoint at a task or day boundary/);
    expect(instructions).not.toMatch(/Claude|Cursor|Codex|Gemini/);

    await mneia.shutdown();
  });

  it('refuses to start when a tool schema cannot be advertised, rather than failing on first call', () => {
    const malformed: ErasedToolDefinition = {
      ...stubTool('mneia_search'),
      inputSchema: { type: 'array' },
    };

    expect(() => serverWith([malformed])).toThrow(ToolAdvertisementError);
    expect(() => serverWith([malformed])).toThrow(/inputSchema/);
  });
});

describe('createMneiaServer error handling', () => {
  it('returns a structured error for an unknown tool instead of failing the request', async () => {
    const mneia = serverWith([stubTool('mneia_rehydrate')]);
    const client = await connectClient(mneia);

    const result = await client.callTool({ name: 'query', arguments: {} });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('mneia_rehydrate');

    await mneia.shutdown();
  });

  it('names the milestone for a tool that has not shipped, without opening a session first', async () => {
    let sessions = 0;
    const mneia = serverWith([stubTool('mneia_rehydrate')], {
      context: (run) => {
        sessions += 1;
        return run(CONTEXT);
      },
    });
    const client = await connectClient(mneia);

    const result = await client.callTool({ name: 'mneia_conflicts', arguments: {} });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('M4');
    expect(sessions).toBe(0);

    await mneia.shutdown();
  });

  it('survives a throwing tool and keeps answering afterwards', async () => {
    let calls = 0;
    const mneia = serverWith([
      stubTool('mneia_checkpoint', () => {
        calls += 1;
        if (calls === 1) {
          return Promise.reject(new Error('connection terminated unexpectedly'));
        }
        return Promise.resolve({ content: [{ type: 'text', text: 'checkpoint written' }] });
      }),
    ]);
    const client = await connectClient(mneia);

    const failed = await client.callTool({ name: 'mneia_checkpoint', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(firstText(failed)).toContain('connection terminated unexpectedly');

    const recovered = await client.callTool({ name: 'mneia_checkpoint', arguments: {} });
    expect(recovered.isError).toBeUndefined();
    expect(firstText(recovered)).toBe('checkpoint written');

    await mneia.shutdown();
  });

  it('reports a session that cannot be opened as a store failure the agent can act on', async () => {
    const mneia = serverWith([stubTool('mneia_rehydrate')], {
      context: () => {
        throw new Error(
          'the Mneia API client is not wired yet. Write ~/.mneia/local.json with databaseUrl, workspaceId and agentActorId',
        );
      },
    });
    const client = await connectClient(mneia);

    const result = await client.callTool({ name: 'mneia_rehydrate', arguments: {} });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain('not wired yet');
    expect(firstText(result)).toContain('local.json');

    await mneia.shutdown();
  });
});

describe('createMneiaServer shutdown', () => {
  it('closes the transport, then flushes and closes telemetry, then closes the store', async () => {
    const order: string[] = [];
    const telemetry: TelemetryEmitter = {
      emit: () => Promise.resolve(),
      flush: () => {
        order.push('telemetry.flush');
        return Promise.resolve();
      },
      close: () => {
        order.push('telemetry.close');
        return Promise.resolve();
      },
    };

    const mneia = serverWith([stubTool('mneia_rehydrate')], {
      telemetry,
      closeStore: () => {
        order.push('store.close');
        return Promise.resolve();
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const closeTransport = serverTransport.close.bind(serverTransport);
    serverTransport.close = async () => {
      order.push('transport.close');
      await closeTransport();
    };
    const client = new Client({ name: 'mneia-test-client', version: '0.0.0' });
    await Promise.all([mneia.connect(serverTransport), client.connect(clientTransport)]);

    await mneia.shutdown();

    const firstOf = order.filter((stage, index) => order.indexOf(stage) === index);
    expect(firstOf).toEqual([
      'transport.close',
      'telemetry.flush',
      'telemetry.close',
      'store.close',
    ]);
  });

  it('runs the shutdown sequence once however often it is requested', async () => {
    let closed = 0;
    const mneia = serverWith([stubTool('mneia_rehydrate')], {
      closeStore: () => {
        closed += 1;
        return Promise.resolve();
      },
    });
    await connectClient(mneia);

    await Promise.all([mneia.shutdown(), mneia.shutdown()]);
    await mneia.shutdown();

    expect(closed).toBe(1);
  });

  it('lets an in-flight call finish in full, and turns a later call away', async () => {
    const started = deferred<void>();
    const release = deferred<void>();

    const mneia = serverWith([
      stubTool('mneia_checkpoint', async () => {
        started.resolve();
        await release.promise;
        return { content: [{ type: 'text', text: 'checkpoint written in full' }] };
      }),
    ]);
    const client = await connectClient(mneia);

    const inFlight = client.callTool({ name: 'mneia_checkpoint', arguments: {} });
    await started.promise;

    const shutdown = mneia.shutdown();

    const turnedAway = await client.callTool({ name: 'mneia_checkpoint', arguments: {} });
    expect(turnedAway.isError).toBe(true);
    expect(firstText(turnedAway)).toContain('shutting down');

    release.resolve();
    const completed = await inFlight;
    expect(firstText(completed)).toBe('checkpoint written in full');

    await shutdown;
  });

  it('gives up draining after the timeout rather than hanging the session', async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const warnings: string[] = [];

    const mneia = serverWith(
      [
        stubTool('mneia_search', async () => {
          started.resolve();
          await release.promise;
          return { content: [{ type: 'text', text: 'late' }] };
        }),
      ],
      { shutdownTimeoutMs: 5, onWarn: (message) => warnings.push(message) },
    );
    const client = await connectClient(mneia);

    const abandoned = client.callTool({ name: 'mneia_search', arguments: {} }).catch(() => null);
    await started.promise;

    await mneia.shutdown();

    expect(warnings.join(' ')).toContain('did not finish within 5ms');

    release.resolve();
    await abandoned;
  });
});

describe('stdout belongs to the protocol', () => {
  function capture(): { readonly stream: Writable; readonly written: string[] } {
    const written: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        written.push(String(chunk));
        done();
      },
    });
    return { stream, written };
  }

  it('sends console output to stderr, never to stdout, once the redirect is installed', () => {
    const stderr = capture();
    const toStdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const restore = redirectConsoleToStderr(stderr.stream);

    try {
      console.log('a stray log line');
      console.error('a deliberate error line');
    } finally {
      restore();
      toStdout.mockRestore();
    }

    expect(stderr.written.join('')).toContain('a stray log line');
    expect(stderr.written.join('')).toContain('a deliberate error line');
    expect(toStdout).not.toHaveBeenCalled();
  });

  it('restores the original console when the redirect is undone', () => {
    const stderr = capture();
    const before = globalThis.console;
    const restore = redirectConsoleToStderr(stderr.stream);
    restore();

    expect(globalThis.console).toBe(before);
  });

  it('has no console call, and no stdout write outside bin.ts, in the package source', async () => {
    const sourceDir = fileURLToPath(new URL('.', import.meta.url));
    const entries = await readdir(sourceDir, { recursive: true });
    const sources = entries.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'));

    expect(sources.length).toBeGreaterThan(3);

    const consoleCall = /\bconsole\s*\.\s*(log|info|debug|warn|error|trace|dir|table)\b/;
    const stdoutWrite = /\bprocess\s*\.\s*stdout\b/;
    const offenders: string[] = [];

    for (const entry of sources) {
      const source = await readFile(join(sourceDir, entry), 'utf8');
      if (consoleCall.test(source)) {
        offenders.push(`${entry} calls console directly`);
      }
      if (stdoutWrite.test(source) && !entry.endsWith('bin.ts')) {
        offenders.push(`${entry} writes to process.stdout`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
