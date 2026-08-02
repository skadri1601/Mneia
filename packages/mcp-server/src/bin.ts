#!/usr/bin/env node
import type { TelemetryEmitter } from '@mneia/core';
import { createNoopEmitter, createTelemetryEmitter, VERSION } from '@mneia/core';
import type { ServerConfig } from './config.js';
import { ConfigError, describeConfigError, loadServerConfig } from './config.js';
import type { ErasedToolDefinition } from './registry.js';
import { findToolDefinition, ToolRegistrationError, ToolRegistry } from './registry.js';
import type { MneiaServer, ServerLogger, ToolContextProvider } from './server.js';
import { createStderrLogger, redirectConsoleToStderr, startStdioServer } from './server.js';
import { assertTool } from './tools/assert.js';
import { checkpointTool } from './tools/checkpoint.js';
import { rehydrateTool } from './tools/rehydrate.js';
import { searchTool } from './tools/search.js';

interface PendingTool {
  readonly toolName: string;
  readonly module: string;
  readonly ticket: string;
}

const TOOLS_DIRECTORY = './tools/';

const PENDING_TOOLS: readonly PendingTool[] = [];

const HELP = `mneia-mcp — the Mneia MCP server (stdio transport)

Usage:
  mneia-mcp              speak MCP over stdin/stdout; run it from an MCP client
  mneia-mcp --version    print the version
  mneia-mcp --help       print this message

Environment:
  MNEIA_TOKEN            Mneia API token. Required in CI and any non-interactive
                         environment; otherwise \`mneia login\` writes one to
                         ~/.mneia/credentials.
  MNEIA_API_URL          Mneia API endpoint. Defaults to https://api.mneia.dev.
  MNEIA_TELEMETRY        Set to off to opt out of telemetry.
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
  return createTelemetryEmitter({
    sinks: [],
    enabled: true,
    onError: (error) => {
      logger.warn(`telemetry sink ${error.sinkName} failed: ${error.message}`);
    },
  });
}

function createContextProvider(config: ServerConfig): ToolContextProvider {
  return () => {
    throw new Error(
      `the Mneia API client is not wired yet (MNE-101 — hosted API scaffold and auth), so no tool can reach ${config.endpoint}`,
    );
  };
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

  const mneia = await startStdioServer({
    registry,
    context: createContextProvider(config),
    telemetry,
    logger,
  });

  installProcessHandlers(mneia, logger);

  const binding =
    config.project === null ? 'no project bound' : `project ${config.project.project}`;
  logger.info(
    `serving ${registry.names().join(', ')} on stdio — endpoint ${config.endpoint}, ${binding}, telemetry ${config.telemetryEnabled ? 'on' : 'off'}`,
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
