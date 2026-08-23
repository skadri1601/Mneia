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
}

const clientFlag = (
  value: string | boolean | undefined,
  supported: readonly McpClient[],
): McpClient | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new CliError(
      'usage',
      '--client needs a client name',
      `choose one of: ${supported.join(', ')}`,
    );
  }
  if (!supported.includes(value as McpClient)) {
    throw new CliError(
      'usage',
      `unknown MCP client "${value}"`,
      `choose one of: ${supported.join(', ')}`,
    );
  }
  return value as McpClient;
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

const resolveClients = async (
  config: McpConfigApi,
  client: string | boolean | undefined,
  all: string | boolean | undefined,
): Promise<readonly McpClient[]> => {
  const supported = [...config.supportedClients()].sort();
  if (client !== undefined && isTrueFlag(all)) {
    throw new CliError(
      'usage',
      '--client and --all cannot be used together',
      'choose one client or pass --all',
    );
  }
  const explicit = clientFlag(client, supported);
  const clients =
    explicit !== undefined
      ? [explicit]
      : isTrueFlag(all)
        ? supported
        : [...(await config.detectClients())].sort();

  if (clients.length === 0) {
    throw new CliError(
      'not_configured',
      'no supported MCP client was detected',
      `choose one explicitly with --client (${supported.join(', ')})`,
    );
  }
  return clients;
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
    const server = mneiaServer(groups, client);
    return server !== undefined && !isCanonicalMneia(server.config);
  });
  if (conflicts.length > 0 && !yes) {
    throw new CliError(
      'usage',
      `MNEIA already has different configuration in ${conflicts.join(', ')}; pass --yes to replace it`,
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

    const clients = await resolveClients(dependencies.config, flags.client, flags.all);
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
