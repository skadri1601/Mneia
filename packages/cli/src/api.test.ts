import { ApiError } from '@mneia/core';
import { describe, expect, it } from 'vitest';
import { callApi } from './api.js';
import { CliError, EXIT_AUTH, EXIT_FAILED, EXIT_NETWORK, EXIT_NOT_CONFIGURED } from './command.js';

const failWith = async (error: unknown): Promise<CliError> => {
  try {
    await callApi('https://app.mneia.dev', 'brief', () => Promise.reject(error));
  } catch (thrown) {
    if (thrown instanceof CliError) {
      return thrown;
    }
    throw thrown;
  }
  throw new Error('expected callApi to reject');
};

describe('callApi error mapping', () => {
  it('reads a rejected token as an auth failure, not as something to retry', async () => {
    const error = await failWith(new ApiError('invalid_token', 'that token was revoked', 401));

    expect(error.exitCode).toBe(EXIT_AUTH);
    expect(error.message).toContain('that token was revoked');
    expect(error.fix).toContain('mneia login');
    expect(error.fix).not.toContain('retry');
  });

  it('reads an unknown project as configuration, not as a server fault', async () => {
    const error = await failWith(new ApiError('not_found', 'no project named checkout', 404));

    expect(error.exitCode).toBe(EXIT_NOT_CONFIGURED);
    expect(error.fix).toContain('.mneia/config.json');
  });

  it('says plainly that a refused supersede wrote nothing', async () => {
    const error = await failWith(
      new ApiError('supersede_refused', 'an agent may not replace a human-confirmed item', 409),
    );

    expect(error.exitCode).toBe(EXIT_FAILED);
    expect(error.fix).toContain('nothing was written');
  });

  it('does not tell a caller to retry a body the server will always refuse', async () => {
    const error = await failWith(
      new ApiError(
        'payload_too_large',
        'the request body is 9000000 bytes and the limit is 8388608',
        413,
      ),
    );

    expect(error.exitCode).toBe(EXIT_FAILED);
    expect(error.message).toContain('the limit is 8388608');
    expect(error.fix).toContain('fails the same way');
    expect(error.fix).not.toContain('report it if it keeps failing');
  });

  it('reads a rate limit as a limit reached, not as a bug to report', async () => {
    const error = await failWith(
      new ApiError('rate_limited', 'you have used 200 of 200 checkpoints today', 429),
    );

    expect(error.exitCode).toBe(EXIT_FAILED);
    expect(error.fix).toContain('not a fault');
    expect(error.fix).not.toContain('report it if it keeps failing');
  });

  it('tells a stale client to upgrade rather than to retry', async () => {
    const error = await failWith(
      new ApiError('unsupported', 'this API does not serve retire', 501),
    );

    expect(error.exitCode).toBe(EXIT_FAILED);
    expect(error.fix).toContain('upgrade @mneia/cli');
    expect(error.fix).not.toContain('report it if it keeps failing');
  });

  it('still tells a developer whose network dropped that their token is fine', async () => {
    const error = await failWith(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }));

    expect(error.exitCode).toBe(EXIT_NETWORK);
    expect(error.fix).toContain('network');
  });
});
