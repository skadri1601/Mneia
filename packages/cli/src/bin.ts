#!/usr/bin/env node
import { VERSION } from '@mneia/core';
import type { CommandDefinition, CommandIo } from './command.js';
import { briefCommand } from './commands/brief.js';
import { checkpointCommand } from './commands/checkpoint.js';
import { handoffCommand } from './commands/handoff.js';
import { initCommand } from './commands/init.js';
import { logCommand } from './commands/log.js';
import { loginCommand } from './commands/login.js';
import { mcpCommand } from './commands/mcp.js';
import { pickupCommand } from './commands/pickup.js';
import { reviewCommand } from './commands/review.js';
import { sessionsCommand } from './commands/sessions.js';
import { statusCommand } from './commands/status.js';
import { teamCommand } from './commands/team.js';
import { verifyCommand } from './commands/verify.js';
import { whoamiCommand } from './commands/whoami.js';
import { route } from './router.js';
import { completionItems, PROMPT, runSession } from './session.js';
import { createSessionPreflight } from './session-auth.js';
import { createLineReader } from './session-editor.js';
import { createHistoryStore } from './session-history.js';
import { CLEAR_SCREEN, createTheme } from './session-theme.js';

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
  handoffCommand,
  pickupCommand,
  teamCommand,
  sessionsCommand,
  checkpointCommand,
  logCommand,
  statusCommand,
  verifyCommand,
  reviewCommand,
  loginCommand,
  whoamiCommand,
  mcpCommand,
];

const dispatch = (argv: readonly string[]): Promise<number> =>
  route({ argv, commands, io, version: VERSION });

const startsInteractively = (argv: readonly string[]): boolean =>
  argv.length === 0 && process.stdin.isTTY === true && process.stdout.isTTY === true;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (startsInteractively(argv)) {
    const theme = createTheme({ isTty: true, env: process.env });
    const clearScreen = (): void => {
      process.stdout.write(CLEAR_SCREEN);
    };

    process.exitCode = await runSession({
      io,
      commands,
      version: VERSION,
      preflight: createSessionPreflight({ io, signIn: () => dispatch(['login']) }),
      readLine: createLineReader({
        input: process.stdin,
        output: process.stdout,
        items: completionItems(commands),
        prompt: PROMPT,
        theme,
        clearScreen,
      }),
      dispatch,
      clearScreen,
      theme,
      history: createHistoryStore(process.env),
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
