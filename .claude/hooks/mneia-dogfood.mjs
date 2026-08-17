import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const DISABLE_ENV_VAR = 'MNEIA_DOGFOOD';
export const CLI_ENV_VAR = 'MNEIA_DOGFOOD_CLI';
export const TIMEOUT_ENV_VAR = 'MNEIA_DOGFOOD_TIMEOUT_MS';
export const MIN_TURNS_ENV_VAR = 'MNEIA_DOGFOOD_MIN_TURNS';

export const STATE_DIR = join('.mneia', 'dogfood');
export const LOCK_STALE_MS = 10 * 60 * 1000;
export const MAX_ROOT_WALK = 12;
export const LOCAL_CLI_RELATIVE = join('packages', 'cli', 'dist', 'bin.js');

export function disabled() {
  const configured = String(process.env[DISABLE_ENV_VAR] ?? '').trim();
  return configured.toLowerCase() === 'off';
}

function positiveIntFrom(raw, fallback) {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function timeoutMs(fallback) {
  return positiveIntFrom(process.env[TIMEOUT_ENV_VAR], fallback);
}

export function minNewTurns(fallback) {
  return positiveIntFrom(process.env[MIN_TURNS_ENV_VAR], fallback);
}

export function readPayload() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

export function repoRootFrom(startDir) {
  const start = resolve(String(startDir ?? process.cwd()));
  let dir = start;
  for (let depth = 0; depth < MAX_ROOT_WALK; depth += 1) {
    if (existsSync(join(dir, '.mneia', 'config.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return start;
}

export function projectBinding(root) {
  try {
    const parsed = JSON.parse(readFileSync(join(root, '.mneia', 'config.json'), 'utf8'));
    if (typeof parsed?.workspace !== 'string' || typeof parsed?.project !== 'string') {
      return null;
    }
    return { workspace: parsed.workspace, project: parsed.project };
  } catch {
    return null;
  }
}

export function sessionIdOf(payload) {
  const id = payload?.session_id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

function safeName(sessionId) {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128);
}

export function stateDirIn(root) {
  return join(root, STATE_DIR);
}

export function statePathFor(root, sessionId) {
  return join(stateDirIn(root), `${safeName(sessionId)}.json`);
}

export function lockPathFor(root, sessionId) {
  return join(stateDirIn(root), `${safeName(sessionId)}.lock`);
}

export function logPathIn(root) {
  return join(stateDirIn(root), 'log.jsonl');
}

function ensureStateDir(root) {
  try {
    mkdirSync(stateDirIn(root), { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export function readState(root, sessionId) {
  try {
    const parsed = JSON.parse(readFileSync(statePathFor(root, sessionId), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function writeState(root, sessionId, state) {
  if (!ensureStateDir(root)) {
    return false;
  }
  try {
    writeFileSync(statePathFor(root, sessionId), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

export function appendLog(root, entry) {
  if (!ensureStateDir(root)) {
    return false;
  }
  try {
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
    appendFileSync(logPathIn(root), `${line}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function createLockFile(path) {
  try {
    writeFileSync(path, `${process.pid}\n`, { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function lockIsStale(path, staleMs) {
  try {
    return Date.now() - statSync(path).mtimeMs > staleMs;
  } catch {
    return false;
  }
}

export function releaseLock(root, sessionId) {
  try {
    unlinkSync(lockPathFor(root, sessionId));
    return true;
  } catch {
    return false;
  }
}

export function claimLock(root, sessionId, staleMs = LOCK_STALE_MS) {
  if (!ensureStateDir(root)) {
    return false;
  }
  const path = lockPathFor(root, sessionId);
  if (createLockFile(path)) {
    return true;
  }
  if (!lockIsStale(path, staleMs)) {
    return false;
  }
  releaseLock(root, sessionId);
  return createLockFile(path);
}

export function countTurns(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath.trim().length === 0) {
    return null;
  }
  try {
    return readFileSync(transcriptPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0).length;
  } catch {
    return null;
  }
}

const SHELL_SAFE = /^[A-Za-z0-9 _.,:/@=+-]*$/;

function attempt(command, args, cwd, ms, useShell) {
  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    timeout: ms,
    killSignal: 'SIGKILL',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: useShell,
  });
}

export function resolveCli(root) {
  const configured = String(process.env[CLI_ENV_VAR] ?? '').trim();
  if (configured.length > 0) {
    return { command: configured, prefix: [], label: configured, source: 'env' };
  }

  const local = join(String(root ?? process.cwd()), LOCAL_CLI_RELATIVE);
  if (existsSync(local)) {
    return {
      command: process.execPath,
      prefix: [local],
      label: `node ${LOCAL_CLI_RELATIVE}`,
      source: 'repo',
    };
  }

  return { command: 'mneia', prefix: [], label: 'mneia', source: 'path' };
}

export function runMneia(args, { cwd, timeoutMs: ms }) {
  const cli = resolveCli(cwd);
  const argv = [...cli.prefix, ...args];

  let result = attempt(cli.command, argv, cwd, ms, false);

  // npm installs the `mneia` bin as a `.cmd` shim on Windows, and since the CVE-2024-27980 fix
  // Node refuses to spawn a .cmd without a shell — so the retry needs `shell: true`, and every
  // argument is checked against SHELL_SAFE first rather than trusted through cmd.exe.
  if (needsWindowsShellRetry(result)) {
    const unsafe = argv.find((arg) => !SHELL_SAFE.test(String(arg)));
    if (unsafe !== undefined) {
      return {
        status: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        unavailable: false,
        client: cli.label,
        clientSource: cli.source,
        failure: `refusing to run ${cli.label} through a shell: the argument ${JSON.stringify(unsafe)} contains characters cmd.exe would reinterpret`,
      };
    }
    result = attempt(
      `${cli.command}.cmd`,
      argv.map((arg) => `"${arg}"`),
      cwd,
      ms,
      true,
    );
  }

  const timedOut = result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL';

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    timedOut,
    unavailable: isMissingCommand(result),
    client: cli.label,
    clientSource: cli.source,
    failure: describeFailure(result, timedOut, cli.label, ms),
  };
}

function needsWindowsShellRetry(result) {
  if (process.platform !== 'win32' || result.error === undefined) {
    return false;
  }
  return result.error.code === 'ENOENT' || result.error.code === 'EINVAL';
}

function isMissingCommand(result) {
  return result.error?.code === 'ENOENT' || result.status === 9009;
}

function describeFailure(result, timedOut, command, ms) {
  if (timedOut) {
    return `${command} did not finish within ${ms}ms`;
  }
  if (isMissingCommand(result)) {
    return `${command} could not be started — run \`pnpm -r build\` so ${LOCAL_CLI_RELATIVE} exists, or set ${CLI_ENV_VAR} to the absolute path of an installed mneia executable`;
  }
  if (result.error !== undefined) {
    return `${command} could not be run: ${result.error.message}`;
  }
  return null;
}

export function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
