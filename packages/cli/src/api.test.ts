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

  it('still tells a developer whose network dropped that their token is fine', async () => {
    const error = await failWith(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }));

    expect(error.exitCode).toBe(EXIT_NETWORK);
    expect(error.fix).toContain('network');
  });
});
