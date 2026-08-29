import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CliError } from './command.js';

/**
 * The harnesses whose session-start hook we can install.
 *
 * All three run a command at session start and read an envelope back off its stdout, so
 * one runtime - `mneia hook session-start` - serves every one of them. What differs is
 * only where the config lives, what the event is called, and the shape of the envelope;
 * the envelope is the hook's problem, and the other two are described here.
 */
export type HookClient = 'claude-code' | 'codex' | 'cursor';

export const HOOK_CLIENTS: readonly HookClient[] = ['claude-code', 'codex', 'cursor'];

/**
 * What Codex is allowed to inject before it spills the slice to disk and shows a preview.
 *
 * Codex defaults this to 2500 tokens and `mneia brief` asks for a 4000 token budget, so
 * the default silently truncates the slice - the one failure that looks like success,
 * because a shorter brief still reads as a brief. Sized above the budget rather than at
 * it: the envelope adds a heading and a provenance footer around the slice.
 */
const CODEX_CONTEXT_LIMIT_TOKENS = 6000;

/**
 * How long a client waits for the slice before starting the session without it.
 *
 * This sits on the critical path of every session start, so it is a latency budget rather
 * than a generous ceiling: past this the client gives up and the session proceeds with no
 * memory loaded, and with no note saying so.
 */
export const HOOK_TIMEOUT_SECONDS = 12;

/**
 * How long `mneia hook` itself waits for the slice, before writing the unavailable note.
 *
 * Strictly below HOOK_TIMEOUT_SECONDS, and that gap is the whole point. The two clocks do
 * not start together: the harness starts counting when it launches the process, while this
 * one starts only after stdin has been read, the config loaded, and the branch looked up -
 * and under `npx` there is a package resolution before any of that. Set equal, a slow API
 * means the harness kills the process during the catch block, so the explicit "memory not
 * loaded" note is never written and the agent cannot tell an empty project from a
 * timed-out one. The headroom below is what buys the note the time to be printed.
 */
export const HOOK_DEADLINE_SECONDS = 8;

/**
 * How long a client waits for the end-of-turn checkpoint before giving up on it.
 *
 * Far larger than the session-start budget because it buys something different. Nothing is
 * waiting on this: the turn has already ended, so the cost of the wait is not latency the
 * person feels but a process lingering. What it has to cover is a transcript extraction
 * through a model, which is seconds to tens of seconds and occasionally worse.
 */
export const STOP_HOOK_TIMEOUT_SECONDS = 60;

/**
 * The floor on that gap, asserted in hooks-config.test.ts rather than trusted to a comment.
 *
 * Process start, stdin, config load, and the git lookup all happen on the harness clock and
 * not on ours; three seconds is what those cost together in the worst case measured.
 */
export const MIN_HOOK_DEADLINE_HEADROOM_SECONDS = 3;

export interface HookClientSpec {
  readonly client: HookClient;
  /** Where the config lives, relative to the repository root. */
  readonly configPath: string;
  /** How this client spells the session-start event inside that file. */
  readonly event: string;
  /**
   * How this client spells the end-of-turn event, or null where we have not verified one.
   *
   * Only Claude Code's `Stop` is verified, against the hook this repository ran by hand for
   * weeks. Codex and Cursor may well have an equivalent, but writing a guessed event name
   * into a user's config is worse than writing nothing: it looks installed, never fires, and
   * the store quietly stays empty. Add one here only with a citation, the way
   * docs/CLIENTS.md carries verified-versus-documented for MCP transports.
   */
  readonly stopEvent: string | null;
  readonly label: string;
}

export const HOOK_CLIENT_SPECS: Readonly<Record<HookClient, HookClientSpec>> = {
  'claude-code': {
    client: 'claude-code',
    configPath: join('.claude', 'settings.json'),
    event: 'SessionStart',
    stopEvent: 'Stop',
    label: 'Claude Code',
  },
  codex: {
    client: 'codex',
    configPath: join('.codex', 'hooks.json'),
    event: 'SessionStart',
    stopEvent: null,
    label: 'Codex',
  },
  cursor: {
    client: 'cursor',
    configPath: join('.cursor', 'hooks.json'),
    event: 'sessionStart',
    stopEvent: null,
    label: 'Cursor',
  },
};

/**
 * How an already-installed entry is recognised on a re-run.
 *
 * Matched on the subcommand rather than the whole command string so an entry a user has
 * edited - a different binary path, an added flag - is still recognised as ours and
 * updated in place, instead of being duplicated beside the original. Not on `mneia hook
 * ...` either, because the npx form below does not carry `mneia` as the command: the two
 * halves are tested separately, so `/opt/bin/mneia hook session-start` and
 * `npx -y @mneia/cli@0.17.0 hook session-start` are both recognised and a foreign hook that
 * merely mentions one of them is not.
 */
const MNEIA_HOOK_MARKER = 'hook session-start';
const MNEIA_STOP_MARKER = 'hook stop';
const MNEIA_PACKAGE_MARKER = 'mneia';

/**
 * The two lifecycle events we install, and what each one is for.
 *
 * Installing only `session-start` is what a repository looked like until now: memory was
 * read at the top of every session and never written at the end of one, so a fresh install
 * rehydrated forever from a store nothing ever filled. Reading without writing is not half
 * a product, it is a product that drains.
 */
export type HookEvent = 'session-start' | 'stop';

export const HOOK_EVENTS: readonly HookEvent[] = ['session-start', 'stop'];

const markerFor = (event: HookEvent): string =>
  event === 'stop' ? MNEIA_STOP_MARKER : MNEIA_HOOK_MARKER;

/**
 * Where the `mneia` this process is running from lives, and whether it will still be there.
 *
 * `npx @mneia/cli init` is a documented way to set a repository up, and it is the one case
 * where a bare `mneia` cannot be persisted: npm unpacks the package into its `_npx` cache
 * and puts that directory on PATH for the lifetime of one process. Write `mneia hook ...`
 * from there and every future session fails with command-not-found - not loudly, but
 * silently, because a hook that cannot start also cannot emit the unavailable-memory
 * envelope that would say so. The agent then reads an absent hook as an empty project.
 */
export interface HookRuntime {
  readonly ephemeral: boolean;
  readonly version: string;
}

const NPX_CACHE_SEGMENT = /[\\/]_npx[\\/]/;

export function detectHookRuntime(
  binPath: string | undefined,
  version: string,
  env: Readonly<Record<string, string | undefined>> = {},
): HookRuntime {
  const fromEnv = env.npm_config_local_prefix;
  const ephemeral =
    (typeof binPath === 'string' && NPX_CACHE_SEGMENT.test(binPath)) ||
    (typeof fromEnv === 'string' && NPX_CACHE_SEGMENT.test(fromEnv));
  return { ephemeral, version };
}

/**
 * The invocation persisted into a client config, which must outlive this process.
 *
 * A permanent install answers to a bare `mneia`, which is what the user typed and what
 * their PATH already resolves. An ephemeral one is pinned through `npx` instead: the
 * version is fixed at the one that ran `mneia init`, so the hook a repository carries does
 * not silently change under it when a new version publishes.
 */
export const hookCommandFor = (
  client: HookClient,
  runtime: HookRuntime,
  event: HookEvent = 'session-start',
): string => {
  const binary = runtime.ephemeral ? `npx -y @mneia/cli@${runtime.version}` : 'mneia';
  return `${binary} ${markerFor(event)} --client ${client}`;
};

const isMneiaEntry = (value: unknown, event: HookEvent): boolean => {
  const command = asRecord(value)?.command;
  return (
    typeof command === 'string' &&
    command.includes(markerFor(event)) &&
    command.includes(MNEIA_PACKAGE_MARKER)
  );
};

export type HookInstallResult = 'created' | 'updated' | 'unchanged';

export interface HookInstallOutcome {
  readonly client: HookClient;
  readonly path: string;
  readonly result: HookInstallResult;
  readonly event: HookEvent;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new CliError(
      'failed',
      `could not read ${path}: ${(cause as Error).message}`,
      'check the file permissions on the repository, then run mneia init again',
    );
  }

  if (text.trim().length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError(
      'failed',
      `${path} is not valid JSON, so the session-start hook cannot be added without discarding what is there`,
      `fix the JSON in ${path} by hand, then run mneia init again`,
    );
  }

  const record = asRecord(parsed);
  if (record === null) {
    throw new CliError(
      'failed',
      `expected ${path} to hold a JSON object; it holds ${Array.isArray(parsed) ? 'an array' : typeof parsed}`,
      `fix ${path} by hand, then run mneia init again`,
    );
  }
  return record;
}

/**
 * The entry we add for a client, in that client's own schema.
 *
 * Claude Code and Codex both nest the command under a matcher group; Cursor takes a flat
 * list. Codex additionally needs its context limit raised - see CODEX_CONTEXT_LIMIT_TOKENS.
 */
function entryFor(
  client: HookClient,
  runtime: HookRuntime,
  event: HookEvent,
): Record<string, unknown> {
  const command = hookCommandFor(client, runtime, event);

  if (client === 'cursor') {
    return { command };
  }

  const inner: Record<string, unknown> = {
    type: 'command',
    command,
    // A checkpoint extracts a transcript through a model, so it is not on the same clock as
    // a slice read. It also blocks nothing: the turn is already over when Stop fires.
    timeout: event === 'stop' ? STOP_HOOK_TIMEOUT_SECONDS : HOOK_TIMEOUT_SECONDS,
    statusMessage:
      event === 'stop' ? 'Checkpointing to project memory' : 'Rehydrating project memory',
  };
  if (client === 'codex' && event === 'session-start') {
    inner.additionalContextLimit = CODEX_CONTEXT_LIMIT_TOKENS;
  }
  return { hooks: [inner] };
}

/**
 * Splices our entry into whatever list the client already has.
 *
 * Every foreign entry is preserved and left in its original order. Ours is replaced where
 * it already exists rather than appended, so running `mneia init` twice does not install
 * the hook twice - which would rehydrate twice and bill for it.
 */
function mergeEntries(
  existing: unknown,
  client: HookClient,
  runtime: HookRuntime,
  event: HookEvent,
): { readonly entries: unknown[]; readonly changed: boolean } {
  const desired = entryFor(client, runtime, event);
  const current = Array.isArray(existing) ? [...existing] : [];
  const index = current.findIndex((entry) => {
    if (isMneiaEntry(entry, event)) return true;
    const nested = asRecord(entry)?.hooks;
    return Array.isArray(nested) && nested.some((one) => isMneiaEntry(one, event));
  });

  if (index < 0) {
    return { entries: [...current, desired], changed: true };
  }
  if (JSON.stringify(current[index]) === JSON.stringify(desired)) {
    return { entries: current, changed: false };
  }
  current[index] = desired;
  return { entries: current, changed: true };
}

/**
 * Writes the session-start hook into one client's config, preserving everything else.
 *
 * The file is read, one key is spliced, and the whole thing is written back - never
 * replaced wholesale. `.claude/settings.json` in particular also governs permissions and
 * environment for the repository, and a setup command that resets those would be a far
 * worse failure than not installing a hook at all.
 */
export async function installSessionStartHook(
  repoRoot: string,
  client: HookClient,
  runtime: HookRuntime,
): Promise<HookInstallOutcome> {
  return installHook(repoRoot, client, runtime, 'session-start');
}

/**
 * Installs the end-of-turn checkpoint hook, where the client has a verified event for it.
 *
 * Returns null rather than throwing for a client with no `stopEvent`, because that is not a
 * failure to report to the user - it is a harness we have not verified an event name for,
 * and the caller says so in its own words.
 */
export async function installStopHook(
  repoRoot: string,
  client: HookClient,
  runtime: HookRuntime,
): Promise<HookInstallOutcome | null> {
  return HOOK_CLIENT_SPECS[client].stopEvent === null
    ? null
    : installHook(repoRoot, client, runtime, 'stop');
}

async function installHook(
  repoRoot: string,
  client: HookClient,
  runtime: HookRuntime,
  event: HookEvent,
): Promise<HookInstallOutcome> {
  const spec = HOOK_CLIENT_SPECS[client];
  const key = event === 'stop' ? spec.stopEvent : spec.event;
  if (key === null) {
    throw new CliError(
      'failed',
      `${spec.label} has no verified ${event} event, so there is nothing to install it under`,
      'this is a bug: check stopEvent in HOOK_CLIENT_SPECS before calling this',
    );
  }
  const path = join(repoRoot, spec.configPath);
  const config = await readJsonFile(path);
  const existed = Object.keys(config).length > 0;

  const hooks = asRecord(config.hooks) ?? {};
  const { entries, changed } = mergeEntries(hooks[key], client, runtime, event);

  if (!changed) {
    return { client, path, result: 'unchanged', event };
  }

  const next: Record<string, unknown> = {
    ...config,
    hooks: { ...hooks, [key]: entries },
  };
  // Cursor rejects a hooks file with no version, and defaults nothing. Set only when
  // absent so a future schema revision the user has already adopted is not walked back.
  if (client === 'cursor' && next.version === undefined) {
    next.version = 1;
  }

  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (cause) {
    throw new CliError(
      'failed',
      `could not write ${path}: ${(cause as Error).message}`,
      'check the file permissions on the repository, then run mneia init again',
    );
  }

  return { client, path, result: existed ? 'updated' : 'created', event };
}
