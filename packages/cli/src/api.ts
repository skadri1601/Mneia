import { ApiError } from '@mneia/core';
import { CliError } from './command.js';

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const CAUSE_DEPTH = 5;

function readOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function networkErrorCode(error: unknown): string | null {
  let current: unknown = error;

  for (let depth = 0; depth < CAUSE_DEPTH; depth += 1) {
    const code = readOf(current, 'code');
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
      return code;
    }
    const name = readOf(current, 'name');
    if (name === 'TimeoutError' || name === 'ConnectTimeoutError') {
      return 'ETIMEDOUT';
    }
    current = readOf(current, 'cause');
    if (current === undefined || current === null) {
      return null;
    }
  }

  return null;
}

function apiFailure(error: ApiError, command: string): CliError {
  if (error.code === 'invalid_token') {
    return new CliError(
      'auth',
      `the Mneia API rejected these credentials: ${error.message}`,
      'run mneia login again, or set MNEIA_TOKEN to a valid token in CI',
    );
  }
  if (error.code === 'forbidden') {
    return new CliError('failed', error.message, 'ask a workspace lead to do this for you');
  }
  if (error.code === 'not_found') {
    return new CliError(
      'not_configured',
      error.message,
      `check the project in .mneia/config.json, then run mneia ${command} again`,
    );
  }
  if (error.code === 'supersede_refused') {
    return new CliError(
      'failed',
      error.message,
      'a human has to confirm that replacement; nothing was written',
    );
  }
  return new CliError(
    'failed',
    `the Mneia API call failed: ${error.message}`,
    'retry, and report it if it keeps failing',
  );
}

export async function callApi<T>(
  endpoint: string,
  command: string,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (error instanceof ApiError) {
      throw apiFailure(error, command);
    }
    const code = networkErrorCode(error);
    if (code !== null) {
      throw new CliError(
        'network',
        `the Mneia API at ${endpoint} could not be reached (${code})`,
        `check your network connection, then run mneia ${command} again — your token is fine`,
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new CliError(
      'failed',
      `the Mneia API call failed: ${detail}`,
      'retry, and report it if it keeps failing',
    );
  }
}
