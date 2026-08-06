#!/usr/bin/env node
import { VERSION } from '@mneia/core';
import type { CommandIo } from './command.js';
import { briefCommand } from './commands/brief.js';
import { checkpointCommand } from './commands/checkpoint.js';
import { initCommand } from './commands/init.js';
import { loginCommand } from './commands/login.js';
import { logCommand } from './commands/log.js';
import { statusCommand } from './commands/status.js';
import { whoamiCommand } from './commands/whoami.js';
import { route } from './router.js';

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
    commands: [
      initCommand,
      briefCommand,
      checkpointCommand,
      logCommand,
      statusCommand,
      loginCommand,
      whoamiCommand,
    ],
    io,
    version: VERSION,
  });
}

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`mneia: ${message}\n`);
  process.exitCode = 1;
});
