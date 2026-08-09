#!/usr/bin/env node
import { join } from 'node:path';
import type {
  HostedIdentity,
  RemoteStore,
  ScopedStore,
  TelemetryEmitter,
  TelemetrySink,
  Uuid,
} from '@mneia/core';
import {
  createHttpTransport,
  createJsonlSink,
  createNoopEmitter,
  createRemoteStore,
  createTelemetryEmitter,
  fetchIdentity,
  PostgresStoreAdapter,
  remoteSinkFromEnv,
  resolveProject,
  VERSION,
} from '@mneia/core';
import type { HostedServerConfig, LocalBinding, ProjectBinding, ServerConfig } from './config.js';
import {
  ConfigError,
  describeConfigError,
  describeDatabaseTarget,
  hostedReviewQueuePath,
  loadServerConfig,
} from './config.js';
import type { ErasedToolDefinition } from './registry.js';
import { findToolDefinition, ToolRegistrationError, ToolRegistry } from './registry.js';
import type { ReviewQueue } from './review-queue.js';
import { createJsonlReviewQueue } from './review-queue.js';
import type { MneiaServer, ServerLogger, ToolContextScope } from './server.js';
import { createStderrLogger, redirectConsoleToStderr, startStdioServer } from './server.js';
import type { SliceLog } from './slices.js';
import { createSliceLog } from './slices.js';
import { PoolConnectionSource } from './store.js';
import { assertTool } from './tools/assert.js';
import { checkpointTool } from './tools/checkpoint.js';
import { rehydrateTool } from './tools/rehydrate.js';
import { searchTool } from './tools/search.js';
import type { ToolContext } from './tools/types.js';

interface PendingTool {
  readonly toolName: string;
  readonly module: string;
  readonly ticket: string;
}

const TOOLS_DIRECTORY = './tools/';

const PENDING_TOOLS: readonly PendingTool[] = [];

const SESSION_TOOL = 'mcp';

const HELP = `mneia-mcp — the Mneia MCP server (stdio transport)

Usage:
  mneia-mcp              speak MCP over stdin/stdout; run it from an MCP client
  mneia-mcp --version    print the version
  mneia-mcp --help       print this message

Hosted API (the default):
  MNEIA_TOKEN            Mneia API token from mneia login. Set it in the MCP
                         client's server config.
  MNEIA_API_URL          Mneia API endpoint. Defaults to https://app.mneia.dev.
  MNEIA_HOME             Directory holding credentials and the local binding.
                         Must be absolute. Defaults to ~/.mneia.

Local store (dogfooding only; takes precedence when the file exists):
  ~/.mneia/local.json    binds this server straight to a Postgres store. Requires
                         workspaceId and agentActorId, and either a databaseUrl
                         field or DATABASE_URL. agentActorId must be an actor of
                         kind "agent" — the server refuses to write otherwise.
  MNEIA_LOCAL_CONFIG     read the binding from this path instead.

Telemetry:
  MNEIA_TELEMETRY        Set to off to opt out. In local mode events are appended
                         to ~/.mneia/events.jsonl unless telemetryPath says otherwise.
  MNEIA_TELEMETRY_ENDPOINT
                         Also transmit events to this URL. Unset means nothing
                         leaves the machine. Events carry ids and outcomes only.
  MNEIA_TELEMETRY_TOKEN  Bearer token for that endpoint, if it needs one.
`;

function describeCause(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) {
    return cause.message;
  }
  return String(cause);
}

function specifierFor(entry: PendingTool): string {
  return TOOLS_DIRECTORY.concat(entry.module);
}

async function loadPendingTool(
  entry: PendingTool,
  logger: ServerLogger,
): Promise<ErasedToolDefinition | null> {
  let loaded: unknown;
  try {
    loaded = await import(specifierFor(entry));
  } catch (cause) {
    logger.warn(
      `${entry.toolName} is not being offered: ${specifierFor(entry)} could not be loaded (${describeCause(cause)}). It lands with ${entry.ticket}; starting without it.`,
    );
    return null;
  }

  const definition = findToolDefinition(loaded, entry.toolName);
  if (definition === null) {
    logger.warn(
      `${entry.toolName} is not being offered: ${specifierFor(entry)} loaded but exports no tool definition named ${entry.toolName}. Check the export in ${entry.ticket}; starting without it.`,
    );
    return null;
  }

  return definition;
}

async function resolveTools(logger: ServerLogger): Promise<readonly ErasedToolDefinition[]> {
  const pending = await Promise.all(PENDING_TOOLS.map((entry) => loadPendingTool(entry, logger)));
  const available = pending.filter(
    (definition): definition is ErasedToolDefinition => definition !== null,
  );
  return [rehydrateTool, assertTool, checkpointTool, searchTool, ...available];
}

function createTelemetry(config: ServerConfig, logger: ServerLogger): TelemetryEmitter {
  if (!config.telemetryEnabled) {
    return createNoopEmitter();
  }

  const sinks: TelemetrySink[] =
    config.mode === 'local'
      ? [
          createJsonlSink({
            filePath: config.local.telemetryPath,
            onError: (error) => {
              logger.warn(
                `${error.lostEvents} telemetry event(s) were lost: ${error.message}. The reference signal for that stretch is unrecoverable.`,
              );
            },
          }),
        ]
      : [];

  const remote = remoteSinkFromEnv(process.env, {
    onError: (error) => {
      logger.warn(`${error.lostEvents} telemetry event(s) were not transmitted: ${error.message}`);
    },
  });
  if (remote !== null) {
    sinks.push(remote);
  }

  return createTelemetryEmitter({
    sinks,
    enabled: true,
    onError: (error) => {
      logger.warn(`telemetry sink ${error.sinkName} failed: ${error.message}`);
    },
  });
}

export class AgentActorError extends Error {
  readonly actorId: Uuid;

  constructor(actorId: Uuid, message: string) {
    super(message);
    this.name = 'AgentActorError';
    this.actorId = actorId;
  }
}

async function assertAgentActor(store: ScopedStore, actorId: Uuid): Promise<void> {
  const actor = await store.getActor(actorId);
  if (actor === null) {
    throw new AgentActorError(
      actorId,
      `agentActorId ${actorId} names no actor in workspace ${store.scope.workspaceId}. Correct it in the local binding, or create the actor, before this server writes anything.`,
    );
  }
  if (actor.kind !== 'agent') {
    throw new AgentActorError(
      actorId,
      `agentActorId ${actorId} is an actor of kind "${actor.kind}", not "agent". Every item written through this server would be recorded as human_confirmed, which lets an agent overrule a human (vision.md §10.1). Point agentActorId at an actor whose kind is agent.`,
    );
  }
}

interface LocalRuntime {
  readonly scope: ToolContextScope;
  readonly start: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly describe: () => string;
}

function createLocalRuntime(
  binding: LocalBinding,
  telemetry: TelemetryEmitter,
  logger: ServerLogger,
): LocalRuntime {
  const adapter = new PostgresStoreAdapter(
    new PoolConnectionSource({
      databaseUrl: binding.databaseUrl,
      onIdleError: (error) => {
        logger.warn(`idle Postgres connection failed: ${error.message}`);
      },
    }),
  );
  const workspaceScope = { workspaceId: binding.workspaceId, actorId: binding.agentActorId };
  const slices: SliceLog = createSliceLog();
  const reviewQueue: ReviewQueue = createJsonlReviewQueue({ filePath: binding.reviewQueuePath });

  let session: { readonly id: Uuid; readonly projectId: Uuid } | null = null;
  let actorVerified = false;

  const sessionIdFor = (projectId: Uuid): Uuid | null =>
    session !== null && session.projectId === projectId ? session.id : null;

  const buildContext = (store: ScopedStore): ToolContext => ({
    store,
    telemetry,
    now: () => new Date(),
    slices,
    reviewQueue,
    sessionIdFor,
    defaultProject: binding.projectId ?? binding.projectSlug,
  });

  const scope: ToolContextScope = <T>(run: (context: ToolContext) => Promise<T>): Promise<T> =>
    adapter.withScope(workspaceScope, async (store) => {
      if (!actorVerified) {
        await assertAgentActor(store, binding.agentActorId);
        actorVerified = true;
      }
      return run(buildContext(store));
    });

  const start = async (): Promise<void> => {
    const projectId = binding.projectId;
    try {
      await adapter.withScope(workspaceScope, async (store) => {
        await assertAgentActor(store, binding.agentActorId);
        actorVerified = true;
        if (projectId !== null) {
          const created = await store.createSession(projectId, SESSION_TOOL);
          session = { id: created.id, projectId };
        }
      });
    } catch (cause) {
      if (cause instanceof AgentActorError) {
        throw cause;
      }
      if (actorVerified) {
        logger.warn(
          `no session row was opened: ${describeCause(cause)}. Items written this run carry no session provenance.`,
        );
        return;
      }
      logger.warn(
        `the local store could not be reached at startup: ${describeCause(cause)}. Tool calls will retry it.`,
      );
    }
  };

  const close = async (): Promise<void> => {
    const open = session;
    if (open !== null) {
      try {
        await adapter.withScope(workspaceScope, (store) => store.endSession(open.id));
      } catch (cause) {
        logger.warn(`session ${open.id} was not closed cleanly: ${describeCause(cause)}`);
      }
    }
    await adapter.close();
  };

  const describe = (): string => {
    const project =
      binding.projectId ?? binding.projectSlug ?? 'no project bound, pass one per tool call';
    return [
      `local store ${describeDatabaseTarget(binding.databaseUrl)} (from ${binding.databaseUrlSource})`,
      `workspace ${binding.workspaceId}`,
      `agent actor ${binding.agentActorId}`,
      `project ${project}`,
      session === null ? 'no session row' : `session ${session.id}`,
      `review queue ${reviewQueue.path ?? 'off'}`,
    ].join(', ');
  };

  return { scope, start, close, describe };
}

interface HostedRuntime {
  readonly scope: ToolContextScope;
  readonly start: () => Promise<void>;
  readonly close: () => Promise<void>;
  readonly describe: () => string;
}

async function resolveBoundProject(
  store: ScopedStore,
  binding: ProjectBinding,
): Promise<Uuid | null> {
  const project = await resolveProject(store, binding.project);
  return project === null ? null : project.id;
}

function createHostedRuntime(
  config: HostedServerConfig,
  telemetry: TelemetryEmitter,
  logger: ServerLogger,
): HostedRuntime {
  const transport = createHttpTransport({
    endpoint: config.endpoint,
    token: config.token,
    userAgent: `mneia-mcp/${VERSION}`,
  });
  const slices: SliceLog = createSliceLog();
  const reviewQueue: ReviewQueue = createJsonlReviewQueue({ filePath: hostedReviewQueuePath() });

  let store: RemoteStore | null = null;
  let identity: HostedIdentity | null = null;
  let session: { readonly id: Uuid; readonly projectId: Uuid } | null = null;

  const sessionIdFor = (projectId: Uuid): Uuid | null =>
    session !== null && session.projectId === projectId ? session.id : null;

  const connect = async (): Promise<RemoteStore> => {
    if (store !== null) {
      return store;
    }
    const resolved = await fetchIdentity(transport);
    identity = resolved;
    store = createRemoteStore({
      transport,
      scope: { workspaceId: resolved.workspaceId, actorId: resolved.actorId },
    });
    return store;
  };

  const scope: ToolContextScope = async <T>(
    run: (context: ToolContext) => Promise<T>,
  ): Promise<T> => {
    const connected = await connect();
    return run({
      store: connected,
      telemetry,
      now: () => new Date(),
      slices,
      reviewQueue,
      sessionIdFor,
      defaultProject: config.project === null ? null : config.project.project,
    });
  };

  const start = async (): Promise<void> => {
    try {
      const connected = await connect();
      const projectId =
        config.project === null ? null : await resolveBoundProject(connected, config.project);
      if (projectId !== null) {
        const created = await connected.createSession(projectId, SESSION_TOOL);
        session = { id: created.id, projectId };
      }
    } catch (cause) {
      logger.warn(
        `the Mneia API at ${config.endpoint} could not be reached at startup: ${describeCause(cause)}. Tool calls will retry it.`,
      );
    }
  };

  const close = async (): Promise<void> => {
    session = null;
  };

  const describe = (): string =>
    [
      `hosted API ${config.endpoint}`,
      identity === null
        ? 'identity not yet resolved'
        : `workspace ${identity.workspaceSlug}, actor ${identity.actorId} (${identity.actorKind})`,
      session === null ? 'no session row' : `session ${session.id}`,
      `review queue ${reviewQueue.path ?? 'off'}`,
    ].join(', ');

  return { scope, start, close, describe };
}

function installProcessHandlers(mneia: MneiaServer, logger: ServerLogger): void {
  const stop = (signal: string): void => {
    void (async () => {
      logger.info(`received ${signal}; draining in-flight tool calls before exiting`);
      await mneia.shutdown();
      process.exit(0);
    })();
  };

  process.on('SIGINT', () => {
    stop('SIGINT');
  });
  process.on('SIGTERM', () => {
    stop('SIGTERM');
  });
  process.on('uncaughtException', (error) => {
    logger.error(`uncaught exception, session continues: ${describeCause(error)}`);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error(`unhandled rejection, session continues: ${describeCause(reason)}`);
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) {
    process.stdout.write(`mneia-mcp ${VERSION}\n`);
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  redirectConsoleToStderr();
  const logger = createStderrLogger();

  const config = await loadServerConfig();
  const registry = new ToolRegistry(await resolveTools(logger));
  const telemetry = createTelemetry(config, logger);

  let scope: ToolContextScope;
  let closeStore: (() => Promise<void>) | undefined;
  let binding: string;
  let telemetryTarget: string;

  if (config.mode === 'local') {
    const runtime = createLocalRuntime(config.local, telemetry, logger);
    try {
      await runtime.start();
    } catch (cause) {
      await runtime.close();
      throw cause;
    }
    scope = runtime.scope;
    closeStore = runtime.close;
    binding = runtime.describe();
    telemetryTarget = config.telemetryEnabled ? config.local.telemetryPath : 'off';
  } else {
    const runtime = createHostedRuntime(config, telemetry, logger);
    await runtime.start();
    scope = runtime.scope;
    closeStore = runtime.close;
    binding = runtime.describe();
    telemetryTarget = config.telemetryEnabled ? 'remote sink only' : 'off';
  }

  const mneia = await startStdioServer({
    registry,
    context: scope,
    telemetry,
    closeStore,
    logger,
  });

  installProcessHandlers(mneia, logger);

  logger.info(
    `serving ${registry.names().join(', ')} on stdio — ${binding}, telemetry ${telemetryTarget}`,
  );
}

function reportFatal(cause: unknown): void {
  if (cause instanceof ConfigError) {
    process.stderr.write(`${describeConfigError(cause)}\n`);
    return;
  }
  if (cause instanceof ToolRegistrationError) {
    process.stderr.write(`mneia-mcp cannot start: ${cause.message}\n`);
    return;
  }
  process.stderr.write(`mneia-mcp cannot start: ${describeCause(cause)}\n`);
}

try {
  await main();
} catch (cause) {
  reportFatal(cause);
  process.exit(1);
}
