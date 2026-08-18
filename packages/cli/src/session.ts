import type { CommandDefinition, CommandIo } from './command.js';
import { EXIT_OK } from './command.js';
import { type CompletionItem, type LineEvent, requiresArgument } from './session-editor.js';
import { type HistoryStore, memoryHistoryStore, rememberLine } from './session-history.js';
import { LOGO, plainTheme, shortenPath, type Theme } from './session-theme.js';

export type { LineEvent } from './session-editor.js';

export const SESSION_BUILTIN_NAMES = ['help', 'clear', 'exit'] as const;

export type SessionInput =
  | { readonly kind: 'blank' }
  | { readonly kind: 'exit' }
  | { readonly kind: 'clear' }
  | { readonly kind: 'help'; readonly topic: string | undefined }
  | { readonly kind: 'bare_command'; readonly name: string }
  | { readonly kind: 'argv'; readonly argv: readonly string[] };

export interface SessionContext {
  readonly actor: string | null;
  readonly workspace: string | null;
  readonly project: string | null;
  readonly directory: string;
}

export interface SessionDeps {
  readonly io: CommandIo;
  readonly commands: readonly CommandDefinition[];
  readonly version: string;
  readonly preflight: () => Promise<SessionContext>;
  readonly readLine: (history: readonly string[]) => Promise<LineEvent>;
  readonly dispatch: (argv: readonly string[]) => Promise<number>;
  readonly clearScreen: () => void;
  readonly theme?: Theme;
  readonly history?: HistoryStore;
}

export const PROMPT = '› ';

interface TokenizeState {
  readonly tokens: string[];
  current: string;
  quote: string | null;
  quoted: boolean;
}

function flushToken(state: TokenizeState): void {
  if (state.quoted || state.current.length > 0) {
    state.tokens.push(state.current);
    state.current = '';
    state.quoted = false;
  }
}

function readCharacter(state: TokenizeState, character: string): void {
  if (state.quote !== null) {
    if (character === state.quote) {
      state.quote = null;
    } else {
      state.current += character;
    }
    return;
  }
  if (character === '"' || character === "'") {
    state.quote = character;
    state.quoted = true;
    return;
  }
  if (character === ' ' || character === '\t') {
    flushToken(state);
    return;
  }
  state.current += character;
}

export function tokenize(input: string): string[] {
  const state: TokenizeState = { tokens: [], current: '', quote: null, quoted: false };

  for (const character of input) {
    readCharacter(state, character);
  }
  flushToken(state);

  return state.tokens;
}

export function parseLine(line: string, commandNames: readonly string[]): SessionInput {
  const trimmed = line.trim();

  if (trimmed.length === 0) {
    return { kind: 'blank' };
  }

  if (!trimmed.startsWith('/')) {
    const lowered = trimmed.toLowerCase();
    if (commandNames.includes(lowered)) {
      return { kind: 'bare_command', name: lowered };
    }
    return { kind: 'argv', argv: ['brief', trimmed] };
  }

  const [head, ...rest] = tokenize(trimmed.slice(1));

  if (head === undefined) {
    return { kind: 'blank' };
  }

  const name = head.toLowerCase();

  if (name === 'exit' || name === 'quit') {
    return { kind: 'exit' };
  }
  if (name === 'clear') {
    return { kind: 'clear' };
  }
  if (name === 'help' || name === '?') {
    return { kind: 'help', topic: rest[0] };
  }

  return { kind: 'argv', argv: [name, ...rest] };
}

export const SESSION_BUILTINS: readonly CompletionItem[] = [
  { name: 'help', summary: 'Show every command, or the usage for one.', requiresArgument: false },
  { name: 'clear', summary: 'Clear the screen.', requiresArgument: false },
  { name: 'exit', summary: 'Leave the session.', requiresArgument: false },
];

export function completionItems(commands: readonly CommandDefinition[]): CompletionItem[] {
  const fromCommands = commands.map((command) => ({
    name: command.name,
    summary: command.summary,
    requiresArgument: requiresArgument(command.usage),
  }));

  return [...fromCommands, ...SESSION_BUILTINS].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function bannerLines(
  context: SessionContext,
  version: string,
  theme: Theme = plainTheme,
): string[] {
  const identity =
    context.actor === null
      ? 'not signed in'
      : context.workspace === null || context.workspace === context.actor
        ? context.actor
        : `${context.actor} · ${context.workspace}`;

  const where =
    context.project === null
      ? `${shortenPath(context.directory)}  ·  no project — run /init`
      : `${shortenPath(context.directory)}  ·  ${context.project}`;

  const info = [
    `${theme.bold('mneia')}  ${theme.dim(`v${version}`)}`,
    theme.dim(identity),
    theme.dim(where),
  ];

  const lines = [''];

  for (const [index, mark] of LOGO.entries()) {
    lines.push(`  ${theme.accent(mark)}   ${info[index] ?? ''}`.trimEnd());
  }

  lines.push('', theme.dim('  /help for commands · /exit to leave'), '');

  return lines;
}

export function helpLines(commands: readonly CommandDefinition[]): string[] {
  const width = commands.reduce((longest, command) => Math.max(longest, command.name.length), 6);
  const lines = ['', '  commands'];

  for (const command of [...commands].sort((left, right) => left.name.localeCompare(right.name))) {
    lines.push(`    /${command.name.padEnd(width)}  ${command.summary}`);
  }

  lines.push(
    '',
    '  session',
    `    /${'help'.padEnd(width)}  show this help, or /help <command> for one command's usage`,
    `    /${'clear'.padEnd(width)}  clear the screen`,
    `    /${'exit'.padEnd(width)}  leave the session (Ctrl+D also works)`,
    '',
    '  Anything not starting with / is rehydrated as a task.',
    '  Flags work as they do on the command line: /status --json',
    '',
  );

  return lines;
}

const slashNudge = (name: string): string =>
  [
    '',
    `  Commands start with a slash — try /${name}.`,
    `  To rehydrate for the word "${name}" instead, run /brief ${name}.`,
    '',
    '',
  ].join('\n');

async function applyInput(input: SessionInput, deps: SessionDeps): Promise<'continue' | 'stop'> {
  if (input.kind === 'exit') {
    return 'stop';
  }
  if (input.kind === 'clear') {
    deps.clearScreen();
    return 'continue';
  }
  if (input.kind === 'help') {
    if (input.topic === undefined) {
      deps.io.stdout(`${helpLines(deps.commands).join('\n')}\n`);
    } else {
      await deps.dispatch(['help', input.topic]);
    }
    return 'continue';
  }
  if (input.kind === 'bare_command') {
    deps.io.stdout(slashNudge(input.name));
    return 'continue';
  }
  if (input.kind === 'argv') {
    await deps.dispatch(input.argv);
  }
  return 'continue';
}

export async function runSession(deps: SessionDeps): Promise<number> {
  const { io } = deps;
  const commandNames = deps.commands.map((command) => command.name);
  const store = deps.history ?? memoryHistoryStore;
  const context = await deps.preflight();

  const theme = deps.theme ?? plainTheme;

  io.stdout(`${bannerLines(context, deps.version, theme).join('\n')}\n`);

  let history: string[] = await store.read();
  let interrupted = false;

  for (;;) {
    const event = await deps.readLine(history);

    if (event.kind !== 'line') {
      if (event.kind === 'eof' || interrupted) {
        io.stdout('\n');
        return EXIT_OK;
      }
      interrupted = true;
      io.stdout('\n  Press Ctrl+C again, or type /exit, to leave.\n');
      continue;
    }

    interrupted = false;
    history = rememberLine(history, event.value);
    await store.append(event.value);

    const outcome = await applyInput(parseLine(event.value, commandNames), deps);

    if (outcome === 'stop') {
      return EXIT_OK;
    }
  }
}
