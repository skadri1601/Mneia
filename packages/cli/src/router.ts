import type { CommandDefinition, CommandIo } from './command.js';
import { CliError, EXIT_FAILED, EXIT_OK, EXIT_USAGE } from './command.js';

export const SHIPPED_COMMAND_NAMES = [
  'init',
  'brief',
  'checkpoint',
  'log',
  'status',
  'verify',
  'review',
  'login',
  'whoami',
  'handoff',
  'pickup',
  'team',
  'sessions',
  'mcp',
] as const;

export type ShippedCommandName = (typeof SHIPPED_COMMAND_NAMES)[number];

const SHIPPED_COMMAND_SET: ReadonlySet<string> = new Set(SHIPPED_COMMAND_NAMES);

const LATER_SURFACE_REASONS: Readonly<Record<string, string>> = {
  conflicts: 'conflicts ships in M4',
  sync: 'there is no sync - every mneia command is an authenticated API call',
};

const FLAG_ALIASES: Readonly<Record<string, string>> = {
  h: 'help',
  m: 'message',
};

const ROUTER_BOOLEAN_FLAGS: ReadonlySet<string> = new Set(['json', 'help', 'version']);

export interface ParsedArgv {
  readonly command: string | undefined;
  readonly args: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly json: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export interface UnavailableCommand {
  readonly name: string;
  readonly reason: string;
  readonly fix: string;
}

export interface RouteOptions {
  readonly argv: readonly string[];
  readonly commands: readonly CommandDefinition[];
  readonly io: CommandIo;
  readonly version: string;
  readonly unavailable?: readonly UnavailableCommand[] | undefined;
}

export interface OptionalCommandModule {
  readonly name: string;
  readonly specifier: string;
}

export interface ResolvedCommands {
  readonly commands: readonly CommandDefinition[];
  readonly unavailable: readonly UnavailableCommand[];
}

export type ModuleImporter = (specifier: string) => Promise<unknown>;

const canonicalFlagName = (name: string): string => FLAG_ALIASES[name] ?? name;

const usesNextToken = (name: string, next: string | undefined): next is string =>
  next !== undefined && !ROUTER_BOOLEAN_FLAGS.has(name) && !next.startsWith('-');

const assertFlagName = (name: string, token: string): void => {
  if (name.length === 0) {
    throw new CliError(
      'usage',
      `"${token}" is not a valid flag; a flag needs a name after the dashes`,
      'flags look like --name, --name=value, or --name value',
    );
  }
};

const setFlagValue = (
  flags: Record<string, string | boolean>,
  name: string,
  value: string | boolean,
): void => {
  const current = flags[name];
  if (name === 'client' && typeof current === 'string' && typeof value === 'string') {
    flags[name] = `${current},${value}`;
    return;
  }
  flags[name] = value;
};

const readFlag = (
  body: string,
  next: string | undefined,
  flags: Record<string, string | boolean>,
  token: string,
): number => {
  const separator = body.indexOf('=');

  if (separator >= 0) {
    const name = canonicalFlagName(body.slice(0, separator));
    assertFlagName(name, token);
    setFlagValue(flags, name, body.slice(separator + 1));
    return 0;
  }

  const name = canonicalFlagName(body);
  assertFlagName(name, token);

  if (usesNextToken(name, next)) {
    setFlagValue(flags, name, next);
    return 1;
  }

  setFlagValue(flags, name, true);
  return 0;
};

export function parseArgv(argv: readonly string[]): ParsedArgv {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  let index = 0;
  let afterTerminator = false;

  while (index < argv.length) {
    const token = argv[index];
    index += 1;

    if (token === undefined) {
      continue;
    }
    if (afterTerminator) {
      positionals.push(token);
      continue;
    }
    if (token === '--') {
      afterTerminator = true;
      continue;
    }
    if (token.startsWith('--') && token.length > 2) {
      index += readFlag(token.slice(2), argv[index], flags, token);
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      index += readFlag(token.slice(1), argv[index], flags, token);
      continue;
    }
    positionals.push(token);
  }

  const [command, ...args] = positionals;

  return {
    command,
    args,
    flags,
    json: flags.json === true || flags.json === 'true',
    help: flags.help === true,
    version: flags.version === true,
  };
}

export function assertRegistrableCommands(commands: readonly CommandDefinition[]): void {
  const seen = new Set<string>();

  for (const command of commands) {
    if (!SHIPPED_COMMAND_SET.has(command.name)) {
      throw new Error(
        `command "${command.name}" is outside the shipped CLI surface (${SHIPPED_COMMAND_NAMES.join(', ')}); do not register a command ahead of its milestone`,
      );
    }
    if (seen.has(command.name)) {
      throw new Error(
        `command "${command.name}" is registered twice; every command name must be unique`,
      );
    }
    seen.add(command.name);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isCommandDefinition = (value: unknown): value is CommandDefinition =>
  isRecord(value) &&
  typeof value.name === 'string' &&
  typeof value.summary === 'string' &&
  typeof value.usage === 'string' &&
  typeof value.run === 'function';

const pickCommand = (moduleValue: unknown, name: string): CommandDefinition | undefined => {
  if (!isRecord(moduleValue)) {
    return undefined;
  }

  const candidates: readonly unknown[] = [
    moduleValue[`${name}Command`],
    moduleValue.default,
    ...Object.values(moduleValue),
  ];

  for (const candidate of candidates) {
    if (isCommandDefinition(candidate) && candidate.name === name) {
      return candidate;
    }
  }

  return undefined;
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export async function resolveOptionalCommands(
  modules: readonly OptionalCommandModule[],
  importModule: ModuleImporter,
): Promise<ResolvedCommands> {
  const commands: CommandDefinition[] = [];
  const unavailable: UnavailableCommand[] = [];
  const fix = 'reinstall @mneia/cli; if you are working in the repo, run pnpm build first';

  for (const entry of modules) {
    let loaded: unknown;

    try {
      loaded = await importModule(entry.specifier);
    } catch (error) {
      unavailable.push({
        name: entry.name,
        reason: `${entry.name} is not built into this binary (${entry.specifier} failed to load: ${messageOf(error)})`,
        fix,
      });
      continue;
    }

    const command = pickCommand(loaded, entry.name);

    if (command === undefined) {
      unavailable.push({
        name: entry.name,
        reason: `${entry.specifier} loaded but exported no "${entry.name}" command definition`,
        fix,
      });
      continue;
    }

    commands.push(command);
  }

  return { commands, unavailable };
}

const jsonRequested = (argv: readonly string[]): boolean =>
  argv.some((token) => token === '--json' || token === '--json=true');

const write = (sink: (text: string) => void, lines: readonly string[]): void => {
  sink(`${lines.join('\n')}\n`);
};

const commandLines = (commands: readonly CommandDefinition[]): string[] => {
  const width = commands.reduce((longest, command) => Math.max(longest, command.name.length), 0);
  return [...commands]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((command) => `  ${command.name.padEnd(width)}  ${command.summary}`);
};

const helpLines = (options: RouteOptions): string[] => {
  const lines = [
    `mneia ${options.version} - shared project memory for teams working with AI agents`,
    '',
    'usage: mneia <command> [options]',
    '',
    'commands:',
    ...commandLines(options.commands),
    '',
    'options:',
    '  --json     machine-readable output',
    '  --help     show this help, or the usage of a command',
    '  --version  print the version',
  ];

  const unavailable = options.unavailable ?? [];

  if (unavailable.length > 0) {
    lines.push('', 'not available in this build:');
    for (const entry of unavailable) {
      lines.push(`  ${entry.name}  ${entry.reason}`);
    }
  }

  return lines;
};

const helpPayload = (options: RouteOptions): Record<string, unknown> => ({
  ok: true,
  command: 'help',
  version: options.version,
  commands: options.commands.map((command) => ({
    name: command.name,
    summary: command.summary,
    usage: command.usage,
  })),
  unavailable: (options.unavailable ?? []).map((entry) => ({
    name: entry.name,
    reason: entry.reason,
  })),
});

const emitHelp = (options: RouteOptions, json: boolean, sink: (text: string) => void): void => {
  if (json) {
    sink(`${JSON.stringify(helpPayload(options))}\n`);
    return;
  }
  write(sink, helpLines(options));
};

const emitUsage = (command: CommandDefinition, json: boolean, io: CommandIo): void => {
  if (json) {
    io.stdout(
      `${JSON.stringify({
        ok: true,
        command: command.name,
        summary: command.summary,
        usage: command.usage,
      })}\n`,
    );
    return;
  }
  write(io.stdout, [command.usage, '', command.summary]);
};

const renderFailure = (error: unknown, io: CommandIo, json: boolean): number => {
  const failure =
    error instanceof CliError
      ? error
      : new CliError(
          'failed',
          messageOf(error),
          'this is a bug in mneia - re-run with MNEIA_DEBUG=1 to print the stack trace',
        );

  if (json) {
    io.stderr(
      `${JSON.stringify({
        ok: false,
        error: { kind: failure.kind, message: failure.message, fix: failure.fix },
      })}\n`,
    );
  } else {
    write(io.stderr, [`error: ${failure.message}`, `fix: ${failure.fix}`]);
  }

  if (io.env.MNEIA_DEBUG === '1' && error instanceof Error && error.stack !== undefined) {
    io.stderr(`${error.stack}\n`);
  }

  return failure.exitCode;
};

const unknownCommandError = (
  name: string,
  options: RouteOptions,
  unavailable: readonly UnavailableCommand[],
): CliError => {
  const deferred = unavailable.find((entry) => entry.name === name);

  if (deferred !== undefined) {
    return new CliError('usage', deferred.reason, deferred.fix);
  }

  const later = LATER_SURFACE_REASONS[name];

  if (later !== undefined) {
    return new CliError('usage', later, 'run mneia --help for the commands this build supports');
  }

  const available = [...options.commands]
    .map((command) => command.name)
    .sort((left, right) => left.localeCompare(right))
    .join(', ');

  return new CliError(
    'usage',
    `"${name}" is not an mneia command; this build supports ${available}`,
    'run mneia --help for the full usage',
  );
};

const normalizeExitCode = (code: number): number =>
  Number.isInteger(code) && code >= 0 && code <= 255 ? code : EXIT_FAILED;

const runHelpCommand = (options: RouteOptions, parsed: ParsedArgv): number => {
  const [target] = parsed.args;
  const command = options.commands.find((candidate) => candidate.name === target);

  if (target !== undefined && command === undefined) {
    throw unknownCommandError(target, options, options.unavailable ?? []);
  }
  if (command !== undefined) {
    emitUsage(command, parsed.json, options.io);
    return EXIT_OK;
  }

  emitHelp(options, parsed.json, options.io.stdout);
  return EXIT_OK;
};

export async function route(options: RouteOptions): Promise<number> {
  assertRegistrableCommands(options.commands);

  const { io } = options;

  try {
    const parsed = parseArgv(options.argv);

    if (parsed.version) {
      io.stdout(
        parsed.json
          ? `${JSON.stringify({ version: options.version })}\n`
          : `mneia ${options.version}\n`,
      );
      return EXIT_OK;
    }

    if (parsed.command === undefined) {
      if (parsed.help) {
        emitHelp(options, parsed.json, io.stdout);
        return EXIT_OK;
      }
      emitHelp(options, parsed.json, io.stderr);
      return EXIT_USAGE;
    }

    if (parsed.command === 'help') {
      return runHelpCommand(options, parsed);
    }

    const command = options.commands.find((candidate) => candidate.name === parsed.command);

    if (command === undefined) {
      throw unknownCommandError(parsed.command, options, options.unavailable ?? []);
    }

    if (parsed.help) {
      emitUsage(command, parsed.json, io);
      return EXIT_OK;
    }

    const code = await command.run({
      args: parsed.args,
      flags: parsed.flags,
      json: parsed.json,
      io,
    });

    return normalizeExitCode(code);
  } catch (error) {
    return renderFailure(error, io, jsonRequested(options.argv));
  }
}
