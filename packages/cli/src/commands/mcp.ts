import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import type { CommandDefinition, CommandIo } from '../command.js';
import { CliError, EXIT_FAILED, EXIT_OK } from '../command.js';
import {
  type McpClient,
  type McpConfigApi,
  MNEIA_MCP_SERVER,
  mcpConfigApi,
} from '../mcp-config.js';

export type { McpConfigApi } from '../mcp-config.js';

export interface McpCommandDependencies {
  readonly config: McpConfigApi;
  readonly selectClients?: (detected: readonly McpClient[]) => Promise<readonly McpClient[]>;
}

const clientFlags = (
  value: string | boolean | undefined,
  supported: readonly McpClient[],
): readonly McpClient[] | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new CliError(
      'usage',
      '--client needs a client name',
      `choose one of: ${supported.join(', ')}`,
    );
  }
  const requested = [...new Set(value.split(',').map((client) => client.trim()))].filter(Boolean);
  const unknown = requested.filter((client) => !supported.includes(client as McpClient));
  if (requested.length === 0 || unknown.length > 0) {
    throw new CliError(
      'usage',
      `unknown MCP client "${unknown.join(', ') || value}"`,
      `choose one of: ${supported.join(', ')}`,
    );
  }
  return requested as McpClient[];
};

type McpAction = 'install' | 'list' | 'uninstall';

const readAction = (args: readonly string[]): McpAction => {
  const [action, ...extra] = args;
  if ((action !== 'install' && action !== 'list' && action !== 'uninstall') || extra.length > 0) {
    throw new CliError(
      'usage',
      'mneia mcp expects exactly one of install, list, or uninstall',
      'run mneia mcp --help for usage',
    );
  }
  return action;
};

const isTrueFlag = (value: string | boolean | undefined): boolean =>
  value === true || value === 'true';

const selectClientsInteractive = async (
  detected: readonly McpClient[],
): Promise<readonly McpClient[]> => {
  if (stdin.isTTY !== true || stdout.isTTY !== true) {
    throw new CliError(
      'usage',
      `detected ${detected.join(', ')}, but client selection needs an interactive terminal`,
      'pass one or more --client values, or use --all --yes',
    );
  }
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await reader.question(
      `Detected ${detected.join(', ')}. Which clients should MNEIA configure? `,
    );
    const selected = clientFlags(answer, detected);
    if (selected === undefined || selected.length === 0) {
      throw new CliError(
        'usage',
        'no MCP client was selected',
        'run the command again and name a client',
      );
    }
    return selected;
  } finally {
    reader.close();
  }
};

const resolveClients = async (
  config: McpConfigApi,
  client: string | boolean | undefined,
  all: string | boolean | undefined,
  selectClients: (detected: readonly McpClient[]) => Promise<readonly McpClient[]>,
  interactiveSelection: boolean,
): Promise<readonly McpClient[]> => {
  const supported = [...config.supportedClients()].sort();
  if (client !== undefined && isTrueFlag(all)) {
    throw new CliError(
      'usage',
      '--client and --all cannot be used together',
      'choose one client or pass --all',
    );
  }
  const explicit = clientFlags(client, supported);
  const detected =
    explicit === undefined && !isTrueFlag(all) ? [...(await config.detectClients())].sort() : [];
  const clients = explicit ?? (isTrueFlag(all) ? supported : detected);

  if (clients.length === 0) {
    throw new CliError(
      'not_configured',
      'no supported MCP client was detected',
      `choose one explicitly with --client (${supported.join(', ')})`,
    );
  }
  return explicit !== undefined || isTrueFlag(all) || !interactiveSelection
    ? clients
    : selectClients(clients);
};

const mneiaServer = (groups: Awaited<ReturnType<McpConfigApi['list']>>, client: McpClient) =>
  groups
    .find((group) => group.agentType === client)
    ?.servers.find((server) => server.serverName === 'mneia');

const hasNoValues = (value: unknown): boolean =>
  value === undefined ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' && value !== null && Object.keys(value).length === 0);

const isCanonicalMneia = (config: Readonly<Record<string, unknown>>): boolean =>
  config.command === MNEIA_MCP_SERVER.command &&
  hasNoValues(config.args) &&
  hasNoValues(config.env);

const emit = (
  io: { stdout(text: string): void },
  json: boolean,
  payload: Record<string, unknown>,
  text: string,
): void => {
  io.stdout(json ? `${JSON.stringify(payload)}\n` : `${text}\n`);
};

type ListedServers = Awaited<ReturnType<McpConfigApi['list']>>;

const runList = (
  clients: readonly McpClient[],
  groups: ListedServers,
  io: CommandIo,
  json: boolean,
): number => {
  const installed = clients.flatMap((client) => {
    const server = mneiaServer(groups, client);
    return server === undefined ? [] : [{ client, configPath: server.configPath }];
  });
  emit(
    io,
    json,
    { ok: true, installed, failed: [] },
    installed.length === 0
      ? 'MNEIA is not configured in the selected clients.'
      : installed.map((entry) => `${entry.client}: ${entry.configPath}`).join('\n'),
  );
  return EXIT_OK;
};

const assertReplaceAllowed = (
  clients: readonly McpClient[],
  groups: ListedServers,
  yes: boolean,
): void => {
  const conflicts = clients.filter((client) => {
    const group = groups.find((entry) => entry.agentType === client);
    const server = mneiaServer(groups, client);
    return group?.detected === false || (server !== undefined && !isCanonicalMneia(server.config));
  });
  if (conflicts.length > 0 && !yes) {
    const uninspected = conflicts.filter(
      (client) => groups.find((entry) => entry.agentType === client)?.detected === false,
    );
    throw new CliError(
      'usage',
      uninspected.length > 0
        ? `${uninspected.join(', ')} could not be inspected because the client was not detected; pass --yes to allow a safe merge`
        : `MNEIA already has different configuration in ${conflicts.join(', ')}; pass --yes to replace it`,
      'review the existing entry, then run the same command with --yes',
    );
  }
};

const runInstall = (
  config: McpConfigApi,
  clients: readonly McpClient[],
  groups: ListedServers,
  io: CommandIo,
  json: boolean,
  yes: boolean,
): number => {
  assertReplaceAllowed(clients, groups, yes);
  const changed: McpClient[] = [];
  const unchanged: McpClient[] = [];
  const failed: { client: McpClient; error: string }[] = [];
  for (const client of clients) {
    const server = mneiaServer(groups, client);
    if (server !== undefined && isCanonicalMneia(server.config)) {
      unchanged.push(client);
      continue;
    }
    const result = config.upsert(client, 'mneia', MNEIA_MCP_SERVER);
    if (result.success) changed.push(client);
    else failed.push({ client, error: result.error ?? 'unknown error' });
  }
  emit(
    io,
    json,
    { ok: failed.length === 0, changed, unchanged, failed },
    [
      changed.length > 0 ? `Configured MNEIA for ${changed.join(', ')}.` : '',
      unchanged.length > 0 ? `Already configured: ${unchanged.join(', ')}.` : '',
      ...failed.map((entry) => `Failed for ${entry.client}: ${entry.error}`),
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return failed.length === 0 ? EXIT_OK : EXIT_FAILED;
};

const runUninstall = (
  config: McpConfigApi,
  clients: readonly McpClient[],
  groups: ListedServers,
  io: CommandIo,
  json: boolean,
): number => {
  const removed: McpClient[] = [];
  const unchanged: McpClient[] = [];
  const failed: { client: McpClient; error: string }[] = [];
  for (const client of clients) {
    if (mneiaServer(groups, client) === undefined) {
      unchanged.push(client);
      continue;
    }
    const result = config.remove(client, 'mneia');
    if (result.success && result.removed) removed.push(client);
    else if (result.success) unchanged.push(client);
    else failed.push({ client, error: result.error ?? 'unknown error' });
  }
  emit(
    io,
    json,
    { ok: failed.length === 0, removed, unchanged, failed },
    [
      removed.length > 0 ? `Removed MNEIA from ${removed.join(', ')}.` : '',
      unchanged.length > 0 ? `Not configured: ${unchanged.join(', ')}.` : '',
      ...failed.map((entry) => `Failed for ${entry.client}: ${entry.error}`),
    ]
      .filter(Boolean)
      .join('\n'),
  );
  return failed.length === 0 ? EXIT_OK : EXIT_FAILED;
};

export const createMcpCommand = (dependencies: McpCommandDependencies): CommandDefinition => ({
  name: 'mcp',
  summary: 'Install and manage MNEIA in supported MCP clients',
  usage: 'mneia mcp <install|list|uninstall> [--client <client> | --all] [--yes] [--json]',
  run: async ({ args, flags, json, io }) => {
    const action = readAction(args);
    if (action === 'list' && flags.yes !== undefined) {
      throw new CliError(
        'usage',
        '--yes does not apply to mneia mcp list',
        'remove --yes and run the command again',
      );
    }
    if (action === 'uninstall' && !isTrueFlag(flags.yes)) {
      throw new CliError(
        'usage',
        'mneia mcp uninstall removes client configuration and requires --yes',
        'review the selected client, then run the command with --yes',
      );
    }

    const clients = await resolveClients(
      dependencies.config,
      flags.client,
      flags.all,
      dependencies.selectClients ?? selectClientsInteractive,
      action !== 'list',
    );
    const groups = await dependencies.config.list([...clients]);

    if (action === 'list') {
      return runList(clients, groups, io, json);
    }

    if (action === 'install') {
      return runInstall(dependencies.config, clients, groups, io, json, isTrueFlag(flags.yes));
    }

    return runUninstall(dependencies.config, clients, groups, io, json);
  },
});

export const mcpCommand = createMcpCommand({ config: mcpConfigApi });
