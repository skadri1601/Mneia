import {
  type AgentServers,
  type AgentType,
  detectGlobalAgents,
  getAgentTypes,
  type InstallResult,
  listInstalledServers,
  type McpServerConfig,
  type RemoveServerResult,
  removeServer,
  upsertServer,
} from 'add-mcp';

export type McpClient = AgentType;

export const MNEIA_MCP_SERVER: McpServerConfig = {
  command: 'mneia-mcp',
  args: [],
  env: {},
};

export interface McpConfigApi {
  supportedClients(): readonly McpClient[];
  detectClients(): Promise<readonly McpClient[]>;
  list(clients?: McpClient[]): Promise<readonly AgentServers[]>;
  upsert(client: McpClient, serverName: string, config: McpServerConfig): InstallResult;
  remove(client: McpClient, serverName: string): RemoveServerResult;
}

export const mcpConfigApi: McpConfigApi = {
  supportedClients: () => getAgentTypes(),
  detectClients: () => detectGlobalAgents(),
  list: (clients) =>
    listInstalledServers(
      clients === undefined ? { global: true } : { global: true, agents: clients },
    ),
  upsert: (client, serverName, config) => upsertServer(client, serverName, config),
  remove: (client, serverName) => removeServer(client, serverName),
};
