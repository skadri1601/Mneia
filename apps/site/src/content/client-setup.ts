export type ClientSetup = {
  id: string;
  label: string;
  title: string;
  summary: string;
  installerClient: string | null;
  automaticCommand: string;
  manualLabel: string;
  manualConfig: readonly string[];
  verification: string;
};

const installCommand = (installerClient: string | null): string =>
  installerClient === null
    ? 'mneia mcp install --all --yes'
    : `mneia mcp install --client ${installerClient} --yes`;

export function setupPrompt(client: ClientSetup): string {
  return `Set up MNEIA for ${client.title} in this repository using only supported customer surfaces.

1. Verify Node.js 20.11 or newer is installed.
2. Run: npm install -g @mneia/cli @mneia/mcp-server
3. Run: mneia login
4. Run: mneia init
5. Run: ${installCommand(client.installerClient)}
6. Restart ${client.title} if it was already open.
7. Call mneia_rehydrate for the current task and report the workspace, project, and returned item count.

Do not edit credentials. Do not call private endpoints. Do not inspect the database. Do not bypass the MNEIA CLI or MCP tools. If a supported command fails, stop and report that exact failure instead of working around it. Do not claim setup is verified until mneia_rehydrate succeeds.`;
}

const jsonConfig = [
  '{',
  '  "mcpServers": {',
  '    "mneia": {',
  '      "command": "mneia-mcp",',
  '      "args": []',
  '    }',
  '  }',
  '}',
] as const;

export const CLIENT_SETUPS: readonly ClientSetup[] = [
  {
    id: 'codex',
    label: 'Codex',
    title: 'Codex CLI and desktop',
    summary: 'Install once for Codex. The CLI and desktop app read the same MCP registration.',
    installerClient: 'codex',
    automaticCommand: 'mneia mcp install --client codex --yes',
    manualLabel: 'Codex native fallback',
    manualConfig: ['codex mcp add mneia -- mneia-mcp'],
    verification: 'Restart Codex, then ask it to call mneia_rehydrate for the current task.',
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    title: 'Claude Code',
    summary: 'Register the local stdio server in Claude Code at user scope.',
    installerClient: 'claude-code',
    automaticCommand: 'mneia mcp install --client claude-code --yes',
    manualLabel: 'Claude Code native fallback',
    manualConfig: ['claude mcp add --transport stdio --scope user mneia -- mneia-mcp'],
    verification: 'Restart Claude Code, then ask it to call mneia_rehydrate for the current task.',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    title: 'Claude Desktop',
    summary: 'Write the MNEIA stdio server into Claude Desktop’s global MCP configuration.',
    installerClient: 'claude-desktop',
    automaticCommand: 'mneia mcp install --client claude-desktop --yes',
    manualLabel: 'claude_desktop_config.json',
    manualConfig: jsonConfig,
    verification: 'Fully quit and reopen Claude Desktop, then call mneia_rehydrate in a new chat.',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    title: 'Cursor IDE',
    summary: 'Add MNEIA to Cursor’s global MCP configuration without editing JSON by hand.',
    installerClient: 'cursor',
    automaticCommand: 'mneia mcp install --client cursor --yes',
    manualLabel: '~/.cursor/mcp.json',
    manualConfig: jsonConfig,
    verification: 'Restart Cursor, open MCP settings, then ask the agent to call mneia_rehydrate.',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    title: 'Gemini CLI',
    summary: 'Register MNEIA in Gemini CLI’s global MCP servers.',
    installerClient: 'gemini-cli',
    automaticCommand: 'mneia mcp install --client gemini-cli --yes',
    manualLabel: '~/.gemini/settings.json',
    manualConfig: jsonConfig,
    verification: 'Restart Gemini CLI, then ask it to call mneia_rehydrate for the current task.',
  },
  {
    id: 'vscode',
    label: 'VS Code',
    title: 'VS Code and GitHub Copilot',
    summary: 'Register MNEIA in VS Code’s MCP configuration for Copilot agent mode.',
    installerClient: 'vscode',
    automaticCommand: 'mneia mcp install --client vscode --yes',
    manualLabel: 'VS Code MCP configuration',
    manualConfig: [
      '{',
      '  "servers": {',
      '    "mneia": {',
      '      "type": "stdio",',
      '      "command": "mneia-mcp"',
      '    }',
      '  }',
      '}',
    ],
    verification: 'Reload VS Code, confirm MNEIA is running, then call mneia_rehydrate.',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    title: 'Windsurf',
    summary: 'Add the same local stdio server to Windsurf’s MCP configuration.',
    installerClient: 'windsurf',
    automaticCommand: 'mneia mcp install --client windsurf --yes',
    manualLabel: '~/.codeium/windsurf/mcp_config.json',
    manualConfig: jsonConfig,
    verification: 'Restart Windsurf, then ask Cascade to call mneia_rehydrate.',
  },
  {
    id: 'other',
    label: 'Other MCP',
    title: 'another supported MCP client',
    summary: 'Detect installed clients automatically, or use the standard stdio configuration.',
    installerClient: null,
    automaticCommand: 'mneia mcp install --all --yes',
    manualLabel: 'Generic stdio configuration',
    manualConfig: jsonConfig,
    verification: 'Restart the client, then ask it to call mneia_rehydrate for the current task.',
  },
] as const;
