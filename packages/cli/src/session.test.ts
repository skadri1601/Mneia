import { describe, expect, it } from 'vitest';
import type { CommandDefinition, CommandIo } from './command.js';
import { EXIT_OK } from './command.js';
import {
  bannerLines,
  completeSlash,
  helpLines,
  type LineEvent,
  parseLine,
  rememberLine,
  runSession,
  type SessionContext,
  tokenize,
} from './session.js';

const COMMAND_NAMES = ['brief', 'checkpoint', 'init', 'log', 'login', 'status', 'whoami'];

const stubCommand = (name: string): CommandDefinition => ({
  name,
  summary: `does ${name}`,
  usage: `mneia ${name}`,
  run: () => Promise.resolve(EXIT_OK),
});

const COMMANDS = COMMAND_NAMES.map(stubCommand);

interface Harness {
  readonly stdout: string[];
  readonly stderr: string[];
  readonly dispatched: string[][];
  readonly cleared: { count: number };
  readonly io: CommandIo;
}

function harness(): Harness {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    dispatched: [],
    cleared: { count: 0 },
    io: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      cwd: '/repo',
      env: {},
    },
  };
}

function scriptedReader(events: readonly LineEvent[]): () => Promise<LineEvent> {
  let index = 0;
  return () => {
    const event = events[index] ?? { kind: 'eof' as const };
    index += 1;
    return Promise.resolve(event);
  };
}

const lines = (values: readonly string[]): LineEvent[] =>
  values.map((value) => ({ kind: 'line' as const, value }));

const CONTEXT: SessionContext = {
  actor: 'Saad',
  workspace: 'Mneia',
  project: 'mneia',
};

async function run(events: readonly LineEvent[], context: SessionContext = CONTEXT) {
  const h = harness();
  const code = await runSession({
    io: h.io,
    commands: COMMANDS,
    version: '0.2.0',
    preflight: () => Promise.resolve(context),
    readLine: scriptedReader(events),
    dispatch: (argv) => {
      h.dispatched.push([...argv]);
      return Promise.resolve(EXIT_OK);
    },
    clearScreen: () => {
      h.cleared.count += 1;
    },
  });
  return { ...h, code, output: h.stdout.join('') };
}

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('status --json')).toEqual(['status', '--json']);
  });

  it('keeps a double-quoted argument whole', () => {
    expect(tokenize('checkpoint -m "fixed the deadlock"')).toEqual([
      'checkpoint',
      '-m',
      'fixed the deadlock',
    ]);
  });

  it('keeps a single-quoted argument whole', () => {
    expect(tokenize("brief 'the rehydrate 500'")).toEqual(['brief', 'the rehydrate 500']);
  });

  it('preserves an intentionally empty quoted argument', () => {
    expect(tokenize('brief ""')).toEqual(['brief', '']);
  });

  it('collapses runs of whitespace', () => {
    expect(tokenize('  log   --limit  5 ')).toEqual(['log', '--limit', '5']);
  });
});

describe('parseLine', () => {
  it('treats a blank line as blank', () => {
    expect(parseLine('   ', COMMAND_NAMES)).toEqual({ kind: 'blank' });
  });

  it('routes a slash command to argv without the slash', () => {
    expect(parseLine('/status --json', COMMAND_NAMES)).toEqual({
      kind: 'argv',
      argv: ['status', '--json'],
    });
  });

  it('lowercases the command name but not its arguments', () => {
    expect(parseLine('/BRIEF Fix The Bug', COMMAND_NAMES)).toEqual({
      kind: 'argv',
      argv: ['brief', 'Fix', 'The', 'Bug'],
    });
  });

  it('treats plain text as a brief task, kept as one argument', () => {
    expect(parseLine('fix the rehydrate 500', COMMAND_NAMES)).toEqual({
      kind: 'argv',
      argv: ['brief', 'fix the rehydrate 500'],
    });
  });

  it('does not silently rehydrate when the line is exactly a command name', () => {
    expect(parseLine('status', COMMAND_NAMES)).toEqual({ kind: 'bare_command', name: 'status' });
  });

  it('recognises exit and quit', () => {
    expect(parseLine('/exit', COMMAND_NAMES)).toEqual({ kind: 'exit' });
    expect(parseLine('/quit', COMMAND_NAMES)).toEqual({ kind: 'exit' });
  });

  it('recognises clear', () => {
    expect(parseLine('/clear', COMMAND_NAMES)).toEqual({ kind: 'clear' });
  });

  it('reads help with and without a topic', () => {
    expect(parseLine('/help', COMMAND_NAMES)).toEqual({ kind: 'help', topic: undefined });
    expect(parseLine('/help status', COMMAND_NAMES)).toEqual({ kind: 'help', topic: 'status' });
  });

  it('passes an unknown slash command through so the router explains it', () => {
    expect(parseLine('/handoff', COMMAND_NAMES)).toEqual({ kind: 'argv', argv: ['handoff'] });
  });

  it('treats a bare slash as blank', () => {
    expect(parseLine('/', COMMAND_NAMES)).toEqual({ kind: 'blank' });
  });
});

describe('completeSlash', () => {
  it('completes a slash prefix', () => {
    const [hits] = completeSlash('/st', [...COMMAND_NAMES, 'help']);
    expect(hits).toEqual(['/status']);
  });

  it('offers every command for a bare slash', () => {
    const [hits] = completeSlash('/', COMMAND_NAMES);
    expect(hits).toHaveLength(COMMAND_NAMES.length);
  });

  it('offers nothing for plain text, which is a task not a command', () => {
    expect(completeSlash('fix the', COMMAND_NAMES)).toEqual([[], 'fix the']);
  });

  it('stops completing once the command name is finished', () => {
    expect(completeSlash('/status ', COMMAND_NAMES)).toEqual([[], '/status ']);
  });
});

describe('rememberLine', () => {
  it('puts the newest line first', () => {
    expect(rememberLine(['older'], 'newer')).toEqual(['newer', 'older']);
  });

  it('does not record a blank line', () => {
    expect(rememberLine(['older'], '   ')).toEqual(['older']);
  });

  it('moves a repeated line to the front instead of duplicating it', () => {
    expect(rememberLine(['b', 'a'], 'a')).toEqual(['a', 'b']);
  });
});

describe('bannerLines', () => {
  it('names the workspace, project, and actor', () => {
    const text = bannerLines(CONTEXT, '0.2.0').join('\n');
    expect(text).toContain('mneia 0.2.0');
    expect(text).toContain('Mneia / mneia');
    expect(text).toContain('signed in as Saad');
  });

  it('tells an unbound directory what to run', () => {
    const text = bannerLines({ actor: 'Saad', workspace: 'Mneia', project: null }, '0.2.0').join(
      '\n',
    );
    expect(text).toContain('/init');
  });

  it('omits the actor line when identity is unknown', () => {
    const text = bannerLines({ actor: null, workspace: null, project: 'mneia' }, '0.2.0').join(
      '\n',
    );
    expect(text).not.toContain('signed in as');
  });
});

describe('helpLines', () => {
  it('lists every command and the session builtins', () => {
    const text = helpLines(COMMANDS).join('\n');
    for (const name of COMMAND_NAMES) {
      expect(text).toContain(`/${name}`);
    }
    expect(text).toContain('/exit');
    expect(text).toContain('/clear');
  });
});

describe('runSession', () => {
  it('prints the banner before the first prompt', async () => {
    const session = await run([]);
    expect(session.output).toContain('mneia 0.2.0');
    expect(session.code).toBe(EXIT_OK);
  });

  it('dispatches a slash command through the router', async () => {
    const session = await run(lines(['/status --json']));
    expect(session.dispatched).toEqual([['status', '--json']]);
  });

  it('dispatches plain text as a brief task', async () => {
    const session = await run(lines(['fix the rehydrate 500']));
    expect(session.dispatched).toEqual([['brief', 'fix the rehydrate 500']]);
  });

  it('keeps the session alive across several commands', async () => {
    const session = await run(lines(['/status', '/log', '/whoami']));
    expect(session.dispatched).toEqual([['status'], ['log'], ['whoami']]);
    expect(session.code).toBe(EXIT_OK);
  });

  it('leaves on /exit without dispatching anything after it', async () => {
    const session = await run(lines(['/status', '/exit', '/log']));
    expect(session.dispatched).toEqual([['status']]);
  });

  it('leaves on end of input', async () => {
    const session = await run([{ kind: 'eof' }]);
    expect(session.code).toBe(EXIT_OK);
  });

  it('does not leave on a single interrupt, and says so', async () => {
    const session = await run([{ kind: 'interrupt' }, ...lines(['/status'])]);
    expect(session.output).toContain('Ctrl+C again');
    expect(session.dispatched).toEqual([['status']]);
  });

  it('leaves on two consecutive interrupts', async () => {
    const session = await run([
      { kind: 'interrupt' },
      { kind: 'interrupt' },
      ...lines(['/status']),
    ]);
    expect(session.dispatched).toEqual([]);
  });

  it('forgets the pending interrupt once a line is entered', async () => {
    const session = await run([
      { kind: 'interrupt' },
      ...lines(['/status']),
      { kind: 'interrupt' },
      ...lines(['/log']),
    ]);
    expect(session.dispatched).toEqual([['status'], ['log']]);
  });

  it('renders session help itself rather than dispatching it', async () => {
    const session = await run(lines(['/help']));
    expect(session.dispatched).toEqual([]);
    expect(session.output).toContain('/exit');
  });

  it('dispatches help for a single command to the router', async () => {
    const session = await run(lines(['/help status']));
    expect(session.dispatched).toEqual([['help', 'status']]);
  });

  it('clears the screen without dispatching', async () => {
    const session = await run(lines(['/clear']));
    expect(session.cleared.count).toBe(1);
    expect(session.dispatched).toEqual([]);
  });

  it('ignores a blank line', async () => {
    const session = await run(lines(['', '   ']));
    expect(session.dispatched).toEqual([]);
  });

  it('nudges toward the slash instead of rehydrating a bare command name', async () => {
    const session = await run(lines(['status']));
    expect(session.dispatched).toEqual([]);
    expect(session.output).toContain('/status');
    expect(session.output).toContain('/brief status');
  });

  it('keeps going after a command fails', async () => {
    const h = harness();
    const code = await runSession({
      io: h.io,
      commands: COMMANDS,
      version: '0.2.0',
      preflight: () => Promise.resolve(CONTEXT),
      readLine: scriptedReader(lines(['/status', '/log'])),
      dispatch: (argv) => {
        h.dispatched.push([...argv]);
        return Promise.resolve(argv[0] === 'status' ? 1 : EXIT_OK);
      },
      clearScreen: () => {},
    });
    expect(h.dispatched).toEqual([['status'], ['log']]);
    expect(code).toBe(EXIT_OK);
  });
});
