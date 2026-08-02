#!/usr/bin/env node
import { VERSION } from '@mneia/core';
import type { CommandIo } from './command.js';
import { briefCommand } from './commands/brief.js';
import { initCommand } from './commands/init.js';
import { logCommand } from './commands/log.js';
import { statusCommand } from './commands/status.js';
import type { UnavailableCommand } from './router.js';
import { route } from './router.js';

const UNAVAILABLE: readonly UnavailableCommand[] = [
  {
    name: 'checkpoint',
    reason: 'the interactive confirmation surface has not been built yet',
    fix: 'use the mneia_checkpoint MCP tool for now, or follow MNE-83',
  },
];

const io: CommandIo = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  cwd: process.cwd(),
  env: process.env,
};

async function main(): Promise<void> {
  process.exitCode = await route({
    argv: process.argv.slice(2),
    commands: [initCommand, briefCommand, logCommand, statusCommand],
    io,
    version: VERSION,
    unavailable: UNAVAILABLE,
  });
}

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`mneia: ${message}\n`);
  process.exitCode = 1;
});
