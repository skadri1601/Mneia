import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { ApiAuthError, apiError, apiOk, resolveBearerIdentity } from './api-auth.js';
import { hashSecret } from './device-codes.js';
import { type BearerIdentity, DeviceError } from './store/device-store.js';

const identity: BearerIdentity = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  actorId: '44444444-4444-4444-8444-444444444444',
  tokenId: '55555555-5555-4555-8555-555555555555',
  workspaceName: 'Mneia',
  workspaceSlug: 'mneia',
  actorName: 'claude-code',
  actorKind: 'agent',
  teamId: '66666666-6666-4666-8666-666666666666',
  teamName: 'Engineering',
};

describe('resolveBearerIdentity', () => {
  it('looks the token up by hash, never by the raw secret', async () => {
    const seen: string[] = [];

    const resolved = await resolveBearerIdentity('Bearer s3cret-token', async (tokenHash) => {
      seen.push(tokenHash);
      return identity;
    });

    expect(resolved).toBe(identity);
    expect(seen).toEqual([hashSecret('s3cret-token')]);
    expect(seen.at(0)).not.toBe('s3cret-token');
  });

  it('rejects a request with no Authorization header', async () => {
    await expect(resolveBearerIdentity(null, async () => identity)).rejects.toBeInstanceOf(
      ApiAuthError,
    );
  });

  it('reads an unknown token as an auth failure rather than a crash', async () => {
    await expect(
      resolveBearerIdentity('Bearer nope', async () => {
        throw new DeviceError('unknown_token', 'that token is not recognised');
      }),
    ).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('lets an unexpected store failure surface instead of reporting it as bad credentials', async () => {
    await expect(
      resolveBearerIdentity('Bearer anything', async () => {
        throw new Error('the database is down');
      }),
    ).rejects.toThrow('the database is down');
  });
});

describe('api responses', () => {
  it('maps each error code to the status a client acts on', async () => {
    expect(apiError('invalid_token', 'no token').status).toBe(401);
    expect(apiError('invalid_request', 'bad body').status).toBe(400);
    expect(apiError('not_found', 'no project').status).toBe(404);
    expect(apiError('supersede_refused', 'human-confirmed').status).toBe(409);
    expect(apiError('unsupported', 'M2').status).toBe(501);
    expect(apiError('internal', 'boom').status).toBe(500);
  });

  it('challenges with WWW-Authenticate only when the credential is the problem', () => {
    expect(apiError('invalid_token', 'no token').headers.get('www-authenticate')).toContain(
      'Bearer',
    );
    expect(apiError('not_found', 'no project').headers.get('www-authenticate')).toBeNull();
  });

  it('never lets a response be cached', () => {
    expect(apiOk({ ok: true }).headers.get('cache-control')).toBe('no-store');
    expect(apiError('internal', 'boom').headers.get('cache-control')).toBe('no-store');
  });
});
