import { VERSION } from '@mneia/core';

export type {
  EnvLike,
  FileReader,
  LoadServerConfigOptions,
  ProjectBinding,
  ServerConfig,
} from './config.js';
export {
  CONFIG_DIR,
  CONFIG_FILE,
  ConfigError,
  CREDENTIALS_FILE,
  CREDENTIALS_PATH_ENV_VAR,
  credentialsPath,
  DEFAULT_ENDPOINT,
  describeConfigError,
  ENDPOINT_ENV_VAR,
  loadServerConfig,
  projectConfigPath,
  TELEMETRY_ENV_VAR,
  TELEMETRY_OFF_VALUES,
  TELEMETRY_ON_VALUES,
  TOKEN_ENV_VAR,
} from './config.js';
export type { ErasedToolDefinition, M1ToolName, ToolListing } from './registry.js';
export {
  DEFERRED_TOOL_MILESTONES,
  findToolDefinition,
  isToolDefinition,
  M1_TOOL_NAMES,
  ToolRegistrationError,
  ToolRegistry,
  toolFailure,
} from './registry.js';
export type {
  MneiaServer,
  MneiaServerOptions,
  ServerLogger,
  ToolContextProvider,
} from './server.js';
export {
  createMneiaServer,
  createStderrLogger,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  redirectConsoleToStderr,
  SERVER_INSTRUCTIONS,
  SERVER_NAME,
  startStdioServer,
  ToolAdvertisementError,
  toAdvertisedTool,
  toCallToolResult,
} from './server.js';
export type {
  AnyToolDefinition,
  ToolContentBlock,
  ToolContext,
  ToolDefinition,
  ToolResult,
} from './tools/types.js';
export { VERSION };
