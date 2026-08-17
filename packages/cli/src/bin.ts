#!/usr/bin/env node
import { VERSION } from '@mneia/core';
import type { CommandDefinition, CommandIo } from './command.js';
import { briefCommand } from './commands/brief.js';
import { checkpointCommand } from './commands/checkpoint.js';
import { initCommand } from './commands/init.js';
import { logCommand } from './commands/log.js';
import { loginCommand } from './commands/login.js';
import { statusCommand } from './commands/status.js';
import { whoamiCommand } from './commands/whoami.js';
import { route } from './router.js';
import { createLineReader, runSession } from './session.js';
import { createSessionPreflight } from './session-auth.js';

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

const commands: readonly CommandDefinition[] = [
  initCommand,
  briefCommand,
  checkpointCommand,
  logCommand,
  statusCommand,
  loginCommand,
  whoamiCommand,
];

const dispatch = (argv: readonly string[]): Promise<number> =>
  route({ argv, commands, io, version: VERSION });

const startsInteractively = (argv: readonly string[]): boolean =>
  argv.length === 0 && process.stdin.isTTY === true && process.stdout.isTTY === true;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (startsInteractively(argv)) {
    process.exitCode = await runSession({
      io,
      commands,
      version: VERSION,
      preflight: createSessionPreflight({ io, signIn: () => dispatch(['login']) }),
      readLine: createLineReader(
        { input: process.stdin, output: process.stdout },
        commands.map((command) => command.name),
      ),
      dispatch,
      clearScreen: () => {
        process.stdout.write('\u001b[2J\u001b[H');
      },
    });
    return;
  }

  process.exitCode = await dispatch(argv);
}

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  process.stderr.write(`mneia: ${message}\n`);
  process.exitCode = 1;
});
