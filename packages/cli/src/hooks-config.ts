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
 * than a generous ceiling: past this the hook gives up, says so, and the session proceeds
 * with no memory loaded. `mneia hook` enforces the same number itself so the degradation
 * is ours and legible, rather than the client killing the process mid-write.
 */
export const HOOK_TIMEOUT_SECONDS = 12;

export interface HookClientSpec {
  readonly client: HookClient;
  /** Where the config lives, relative to the repository root. */
  readonly configPath: string;
  /** How this client spells the session-start event inside that file. */
  readonly event: string;
  readonly label: string;
}

export const HOOK_CLIENT_SPECS: Readonly<Record<HookClient, HookClientSpec>> = {
  'claude-code': {
    client: 'claude-code',
    configPath: join('.claude', 'settings.json'),
    event: 'SessionStart',
    label: 'Claude Code',
  },
  codex: {
    client: 'codex',
    configPath: join('.codex', 'hooks.json'),
    event: 'SessionStart',
    label: 'Codex',
  },
  cursor: {
    client: 'cursor',
    configPath: join('.cursor', 'hooks.json'),
    event: 'sessionStart',
    label: 'Cursor',
  },
};

export const hookCommandFor = (client: HookClient): string =>
  `mneia hook session-start --client ${client}`;

/**
 * How an already-installed entry is recognised on a re-run.
 *
 * Matched on the subcommand rather than the whole command string so an entry a user has
 * edited - a different binary path, an added flag - is still recognised as ours and
 * updated in place, instead of being duplicated beside the original.
 */
const MNEIA_HOOK_MARKER = 'mneia hook session-start';

const isMneiaEntry = (value: unknown): boolean => {
  const command = asRecord(value)?.command;
  return typeof command === 'string' && command.includes(MNEIA_HOOK_MARKER);
};

export type HookInstallResult = 'created' | 'updated' | 'unchanged';

export interface HookInstallOutcome {
  readonly client: HookClient;
  readonly path: string;
  readonly result: HookInstallResult;
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
function entryFor(client: HookClient): Record<string, unknown> {
  const command = hookCommandFor(client);

  if (client === 'cursor') {
    return { command };
  }

  const inner: Record<string, unknown> = {
    type: 'command',
    command,
    timeout: HOOK_TIMEOUT_SECONDS,
    statusMessage: 'Rehydrating project memory',
  };
  if (client === 'codex') {
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
): { readonly entries: unknown[]; readonly changed: boolean } {
  const desired = entryFor(client);
  const current = Array.isArray(existing) ? [...existing] : [];
  const index = current.findIndex((entry) => {
    if (isMneiaEntry(entry)) return true;
    const nested = asRecord(entry)?.hooks;
    return Array.isArray(nested) && nested.some(isMneiaEntry);
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
): Promise<HookInstallOutcome> {
  const spec = HOOK_CLIENT_SPECS[client];
  const path = join(repoRoot, spec.configPath);
  const config = await readJsonFile(path);
  const existed = Object.keys(config).length > 0;

  const hooks = asRecord(config.hooks) ?? {};
  const { entries, changed } = mergeEntries(hooks[spec.event], client);

  if (!changed) {
    return { client, path, result: 'unchanged' };
  }

  const next: Record<string, unknown> = {
    ...config,
    hooks: { ...hooks, [spec.event]: entries },
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

  return { client, path, result: existed ? 'updated' : 'created' };
}
