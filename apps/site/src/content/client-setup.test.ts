import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CLIENT_SETUPS, setupPrompt } from './client-setup.js';
import { INTEGRATIONS } from './docs/integrations.js';
import { MCP } from './docs/mcp.js';
import { QUICKSTART } from './docs/quickstart.js';
import { FAQ_GETTING_STARTED } from './faq.js';

const FIRST_CLASS_CLIENTS = [
  'codex',
  'claude-code',
  'claude-desktop',
  'cursor',
  'gemini-cli',
  'vscode',
  'windsurf',
] as const;

describe('client setup content', () => {
  it('keeps every supported public client in one stable order', () => {
    expect(CLIENT_SETUPS.map((client) => client.id)).toEqual([...FIRST_CLASS_CLIENTS, 'other']);
  });

  it('makes every copied prompt a complete customer-surface setup journey', () => {
    for (const client of CLIENT_SETUPS) {
      const prompt = setupPrompt(client);
      const expectedInstall =
        client.installerClient === null
          ? 'mneia mcp install --all --yes'
          : `mneia mcp install --client ${client.installerClient} --yes`;

      expect(prompt).toContain('npm install -g @mneia/cli @mneia/mcp-server');
      expect(prompt).toContain('mneia login');
      expect(prompt).toContain('mneia init');
      expect(prompt).toContain(expectedInstall);
      expect(prompt).toContain('mneia_rehydrate');
      expect(prompt).toContain('slice ID');
      expect(prompt).toContain('token usage');
      expect(prompt).toContain('Do not edit credentials');
      expect(prompt).toContain('Do not call private endpoints');
      expect(prompt).toContain('Do not inspect the database');
      expect(prompt).toContain('Do not commit tokens');
      expect(prompt).toContain('preserve every unrelated client configuration');
    }
  });

  it('copies only the selected client install command', () => {
    for (const selected of CLIENT_SETUPS.filter((client) => client.installerClient !== null)) {
      const prompt = setupPrompt(selected);
      for (const other of FIRST_CLASS_CLIENTS) {
        const command = `mneia mcp install --client ${other} --yes`;
        if (other === selected.installerClient) expect(prompt).toContain(command);
        else expect(prompt).not.toContain(command);
      }
    }
  });

  it('provides an automatic command, manual fallback, and verification for every tab', () => {
    for (const client of CLIENT_SETUPS) {
      expect(client.automaticCommand.length).toBeGreaterThan(0);
      expect(client.manualConfig.length).toBeGreaterThan(0);
      expect(client.verification).toContain('mneia_rehydrate');
    }
  });

  it('embeds the selector in the published MCP clients section', () => {
    const section = INTEGRATIONS.sections.find((entry) => entry.id === 'mcp-clients');
    expect(section?.blocks).toContainEqual({ kind: 'client-setup' });
  });

  it('makes the installer the primary journey across public setup copy', async () => {
    const quickstart = JSON.stringify(QUICKSTART);
    const mcp = JSON.stringify(MCP);
    const faq = JSON.stringify(FAQ_GETTING_STARTED);
    const cliReadme = await readFile(
      new URL('../../../../packages/cli/README.md', import.meta.url),
      'utf8',
    );
    const serverReadme = await readFile(
      new URL('../../../../packages/mcp-server/README.md', import.meta.url),
      'utf8',
    );

    expect(quickstart).toContain('mneia mcp install');
    expect(quickstart).toContain('/docs/integrations#mcp-clients');
    expect(mcp).toContain('/docs/integrations#mcp-clients');
    expect(faq).toContain('mneia mcp install');
    expect(cliReadme).toContain('mneia mcp install --client');
    expect(serverReadme).toContain('mneia mcp install --client');
  });
});
