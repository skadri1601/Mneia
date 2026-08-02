import { Console } from 'node:console';
import type { TelemetryEmitter } from '@mneia/core';
import { VERSION } from '@mneia/core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ToolListing, ToolRegistry } from './registry.js';
import { toolFailure } from './registry.js';
import type { ToolContext, ToolResult } from './tools/types.js';

export const SERVER_NAME = 'mneia';

export const SERVER_INSTRUCTIONS = [
  'Mneia is the shared project memory for this repository.',
  'Call mneia_rehydrate once at the start of a session, and again whenever the task changes, before planning or writing code — it returns the active constraints, the decisions already made, and the open questions.',
  'Call mneia_assert the moment a decision is made, a constraint is stated, or a question is left open, so the next session inherits it.',
  'Call mneia_checkpoint at a task or day boundary to capture the session as a whole.',
  'Items that need a human to confirm come back as a pending queue — surface them to the user rather than treating them as written.',
].join(' ');

export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5000;

export interface ServerLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type ToolContextProvider = () => ToolContext | Promise<ToolContext>;

export interface MneiaServerOptions {
  readonly registry: ToolRegistry;
  readonly context: ToolContextProvider;
  readonly telemetry?: TelemetryEmitter | undefined;
  readonly closeStore?: (() => Promise<void>) | undefined;
  readonly logger?: ServerLogger | undefined;
  readonly version?: string | undefined;
  readonly shutdownTimeoutMs?: number | undefined;
}

export interface MneiaServer {
  readonly server: Server;
  readonly tools: readonly Tool[];
  connect(transport: Transport): Promise<void>;
  shutdown(): Promise<void>;
}

export class ToolAdvertisementError extends Error {
  readonly toolName: string;

  constructor(toolName: string, message: string) {
    super(message);
    this.name = 'ToolAdvertisementError';
    this.toolName = toolName;
  }
}

export function createStderrLogger(stream: NodeJS.WritableStream = process.stderr): ServerLogger {
  const write = (level: string, message: string): void => {
    stream.write(`[mneia-mcp] ${level} ${message}\n`);
  };
  return {
    info: (message) => write('info', message),
    warn: (message) => write('warn', message),
    error: (message) => write('error', message),
  };
}

export function redirectConsoleToStderr(
  stream: NodeJS.WritableStream = process.stderr,
): () => void {
  const previous = globalThis.console;
  globalThis.console = new Console({ stdout: stream, stderr: stream });
  return () => {
    globalThis.console = previous;
  };
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return String(cause);
}

export function toAdvertisedTool(listing: ToolListing): Tool {
  const result = ToolSchema.safeParse({
    name: listing.name,
    title: listing.title,
    description: listing.description,
    inputSchema: listing.inputSchema,
  });

  if (!result.success) {
    throw new ToolAdvertisementError(
      listing.name,
      `${listing.name} cannot be advertised because its inputSchema is not a valid MCP tool schema: ${describeCause(result.error)}. Fix the tool definition so inputSchema is a JSON Schema object with "type": "object".`,
    );
  }

  return result.data;
}

export function toCallToolResult(result: ToolResult): CallToolResult {
  const payload: CallToolResult = {
    content: result.content.map((block) => ({ type: 'text', text: block.text })),
  };
  if (result.isError === true) {
    payload.isError = true;
  }
  if (result.structuredContent !== undefined) {
    payload.structuredContent = result.structuredContent;
  }
  return payload;
}

function raceSettled(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return new Promise<boolean>((settle) => {
    const timer = setTimeout(() => {
      settle(true);
    }, timeoutMs);
    timer.unref();
    void promise.then(
      () => {
        clearTimeout(timer);
        settle(false);
      },
      () => {
        clearTimeout(timer);
        settle(false);
      },
    );
  });
}

export function createMneiaServer(options: MneiaServerOptions): MneiaServer {
  const logger = options.logger ?? createStderrLogger();
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const tools = options.registry.list().map(toAdvertisedTool);

  const server = new Server(
    { name: SERVER_NAME, version: options.version ?? VERSION },
    { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  const inFlight = new Set<Promise<CallToolResult>>();
  let stopping = false;
  let shutdown: Promise<void> | null = null;

  const resolveContext = async (name: string): Promise<ToolContext | ToolResult> => {
    try {
      return await options.context();
    } catch (cause) {
      logger.error(`could not open a Mneia session for ${name}: ${describeCause(cause)}`);
      return toolFailure(
        'store_unavailable',
        `${name} could not reach the Mneia store: ${describeCause(cause)}.`,
        'This is a transport or authentication failure, not a bad argument. Retry once; if it persists, check that MNEIA_TOKEN is set and unexpired and that the API endpoint is reachable, then continue the task without Mneia rather than guessing at prior decisions.',
      );
    }
  };

  const dispatch = async (name: string, rawArguments: unknown): Promise<CallToolResult> => {
    if (stopping) {
      return toCallToolResult(
        toolFailure(
          'server_stopping',
          `mneia-mcp is shutting down and did not run ${name}.`,
          'Nothing was read or written. Reconnect to the Mneia MCP server and call it again.',
        ),
      );
    }

    const refusal = options.registry.refuse(name);
    if (refusal !== null) {
      return toCallToolResult(refusal);
    }

    const context = await resolveContext(name);
    if ('content' in context) {
      return toCallToolResult(context);
    }

    return toCallToolResult(await options.registry.dispatch(name, rawArguments, context));
  };

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const call = dispatch(request.params.name, request.params.arguments);
    inFlight.add(call);
    try {
      return await call;
    } finally {
      inFlight.delete(call);
    }
  });

  const closeQuietly = async (stage: string, run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch (cause) {
      logger.warn(`${stage} failed during shutdown: ${describeCause(cause)}`);
    }
  };

  const drain = async (): Promise<void> => {
    if (inFlight.size === 0) {
      return;
    }
    const pending = inFlight.size;
    const timedOut = await raceSettled(Promise.allSettled([...inFlight]), shutdownTimeoutMs);
    if (timedOut) {
      logger.warn(
        `${pending} tool call(s) did not finish within ${shutdownTimeoutMs}ms; their responses may be truncated`,
      );
    }
  };

  const performShutdown = async (): Promise<void> => {
    stopping = true;
    await drain();
    await closeQuietly('closing the transport', () => server.close());
    await closeQuietly('flushing telemetry', async () => {
      await options.telemetry?.flush();
    });
    await closeQuietly('closing telemetry', async () => {
      await options.telemetry?.close();
    });
    await closeQuietly('closing the store', async () => {
      await options.closeStore?.();
    });
  };

  const requestShutdown = (): Promise<void> => {
    shutdown ??= performShutdown();
    return shutdown;
  };

  server.onclose = () => {
    void requestShutdown();
  };

  return {
    server,
    tools,
    connect: (transport) => server.connect(transport),
    shutdown: requestShutdown,
  };
}

export async function startStdioServer(options: MneiaServerOptions): Promise<MneiaServer> {
  const mneia = createMneiaServer(options);
  await mneia.connect(new StdioServerTransport());
  return mneia;
}
