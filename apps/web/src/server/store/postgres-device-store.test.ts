import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  API_TOKEN_HASH_SETTING,
  DEVICE_CODE_HASH_SETTING,
  DEVICE_USER_CODE_SETTING,
  type PostgresConnectionSource,
  type PostgresSession,
  RLS_POSTURE_SQL,
  type SqlResult,
  type SqlRow,
  type SqlValue,
  WORKSPACE_SETTING,
} from '@mneia/core';
import { DeviceError } from './device-store.js';
import { PostgresDeviceStore } from './postgres-device-store.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_ID = '33333333-3333-4333-8333-333333333333';
const AUTHORIZATION_ID = '44444444-4444-4444-8444-444444444444';
const NEW_ID = '55555555-5555-4555-8555-555555555555';

interface Exchange {
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

type Responder = (sql: string, params: readonly SqlValue[]) => readonly SqlRow[] | undefined;

class FakeSession implements PostgresSession {
  readonly exchanges: Exchange[] = [];
  released = 0;
  discarded = 0;

  constructor(private readonly respond: Responder) {}

  async execute<TRow = Record<string, unknown>>(
    sql: string,
    params: readonly SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    this.exchanges.push({ sql, params });
    if (sql === RLS_POSTURE_SQL) {
      return {
        rows: [
          {
            role_name: 'mneia_app',
            session_role_name: 'mneia_app',
            role_is_superuser: false,
            role_bypasses_rls: false,
            granting_role: null,
            granting_is_superuser: false,
            granting_bypasses_rls: false,
          } as TRow,
        ],
      };
    }
    return { rows: (this.respond(sql, params) ?? []) as unknown as readonly TRow[] };
  }

  async release(): Promise<void> {
    this.released += 1;
  }

  async discard(): Promise<void> {
    this.discarded += 1;
  }

  settingsBefore(fragment: string): Map<string, SqlValue> {
    const index = this.exchanges.findIndex((exchange) => exchange.sql.includes(fragment));
    const settings = new Map<string, SqlValue>();
    for (const exchange of this.exchanges.slice(0, index === -1 ? undefined : index)) {
      if (exchange.sql.includes('set_config')) {
        settings.set(String(exchange.params[0]), exchange.params[1] ?? '');
      }
    }
    return settings;
  }

  ran(fragment: string): boolean {
    return this.exchanges.some((exchange) => exchange.sql.includes(fragment));
  }
}

const sourceOf = (session: PostgresSession): PostgresConnectionSource => ({
  acquire: async () => session,
  close: async () => {},
});

const storeWith = (respond: Responder) => {
  const session = new FakeSession(respond);
  const store = new PostgresDeviceStore(sourceOf(session), () => NEW_ID);
  return { session, store };
};

describe('starting a device authorization', () => {
  it('sets the device code secret and leaves the workspace blank, which is what the insert policy requires', async () => {
    const { session, store } = storeWith(() => []);

    await store.start({
      deviceCodeHash: 'hash-a',
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      clientLabel: 'mneia cli',
      lifetimeSeconds: 900,
    });

    const settings = session.settingsBefore('INSERT INTO device_authorization');
    expect(settings.get(DEVICE_CODE_HASH_SETTING)).toBe('hash-a');
    expect(settings.get(WORKSPACE_SETTING)).toBe('');
  });

  it('checks the connection cannot bypass row level security before it opens a transaction', async () => {
    const { session, store } = storeWith(() => []);

    await store.start({
      deviceCodeHash: 'hash-a',
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      clientLabel: '',
      lifetimeSeconds: 900,
    });

    const postureIndex = session.exchanges.findIndex((e) => e.sql === RLS_POSTURE_SQL);
    const beginIndex = session.exchanges.findIndex((e) => e.sql === 'BEGIN');
    expect(postureIndex).toBeGreaterThanOrEqual(0);
    expect(postureIndex).toBeLessThan(beginIndex);
  });

  it('never writes a status or a claim, so a caller cannot start one pre-approved', async () => {
    const { session, store } = storeWith(() => []);

    await store.start({
      deviceCodeHash: 'hash-a',
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      clientLabel: '',
      lifetimeSeconds: 900,
    });

    const insert = session.exchanges.find((e) =>
      e.sql.includes('INSERT INTO device_authorization'),
    );
    expect(insert?.sql).not.toMatch(/status/i);
    expect(insert?.sql).not.toMatch(/claimed_workspace_id/i);
  });
});

describe('approving from the browser', () => {
  const pendingRespond: Responder = (sql) => {
    if (sql.includes('SELECT confirmation_code')) return [{ confirmation_code: '0417' }];
    if (sql.includes('UPDATE device_authorization')) return [{ id: AUTHORIZATION_ID }];
    if (sql.includes('failed_attempts FROM')) return [];
    return [];
  };

  it('carries both the user code and the approver workspace, which is what the claim policy compares', async () => {
    const { session, store } = storeWith(pendingRespond);

    await store.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      approve: true,
    });

    const settings = session.settingsBefore('UPDATE device_authorization');
    expect(settings.get(DEVICE_USER_CODE_SETTING)).toBe('BCDF-GHJK');
    expect(settings.get(WORKSPACE_SETTING)).toBe(WORKSPACE_ID);
  });

  it('writes the deciding workspace and actor from the session, never from the form', async () => {
    const { session, store } = storeWith(pendingRespond);

    await store.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      approve: true,
    });

    const update = session.exchanges.find((e) => e.sql.includes('UPDATE device_authorization'));
    expect(update?.params).toEqual(['BCDF-GHJK', 'approved', WORKSPACE_ID, ACTOR_ID]);
    expect(update?.params).not.toContain(OTHER_WORKSPACE_ID);
  });

  it('records a denial as a decision, so the deciding actor is stamped either way', async () => {
    const { session, store } = storeWith(pendingRespond);

    await store.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      approve: false,
    });

    const update = session.exchanges.find((e) => e.sql.includes('UPDATE device_authorization'));
    expect(update?.params[1]).toBe('denied');
    expect(update?.params[2]).toBe(WORKSPACE_ID);
  });

  it('refuses a wrong confirmation number and counts it against the approver', async () => {
    const { session, store } = storeWith(pendingRespond);

    await expect(
      store.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        userCode: 'BCDF-GHJK',
        confirmationCode: '9999',
        approve: true,
      }),
    ).rejects.toMatchObject({ code: 'confirmation_mismatch' });

    expect(session.ran('INSERT INTO device_approval_attempt')).toBe(true);
    expect(session.ran('UPDATE device_authorization')).toBe(false);
  });

  it('counts an unknown code too, so guessing codes is capped as well as guessing numbers', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('SELECT confirmation_code')) return [];
      return [];
    });

    await expect(
      store.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        userCode: 'BCDF-GHJK',
        confirmationCode: '0417',
        approve: true,
      }),
    ).rejects.toMatchObject({ code: 'unknown_user_code' });

    expect(session.ran('INSERT INTO device_approval_attempt')).toBe(true);
  });

  it('stops accepting attempts once the cap is reached, before it reads the code', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('failed_attempts FROM')) return [{ failed_attempts: 5 }];
      return [];
    });

    await expect(
      store.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        userCode: 'BCDF-GHJK',
        confirmationCode: '0417',
        approve: true,
      }),
    ).rejects.toMatchObject({ code: 'too_many_attempts' });

    expect(session.ran('SELECT confirmation_code')).toBe(false);
    expect(session.ran('INSERT INTO device_approval_attempt')).toBe(false);
  });

  it('counts a failed attempt in its own transaction, so the rollback cannot erase the count', async () => {
    const { session, store } = storeWith(pendingRespond);

    await expect(
      store.decide({
        workspaceId: WORKSPACE_ID,
        actorId: ACTOR_ID,
        userCode: 'BCDF-GHJK',
        confirmationCode: '9999',
        approve: true,
      }),
    ).rejects.toMatchObject({ code: 'confirmation_mismatch' });

    const commits = session.exchanges.filter((e) => e.sql === 'COMMIT').length;
    const insertIndex = session.exchanges.findIndex((e) =>
      e.sql.includes('INSERT INTO device_approval_attempt'),
    );
    const firstCommitIndex = session.exchanges.findIndex((e) => e.sql === 'COMMIT');

    expect(commits).toBe(2);
    expect(insertIndex).toBeGreaterThan(firstCommitIndex);
    expect(session.ran('ROLLBACK')).toBe(false);
  });

  it('clears the attempt counter after a correct approval', async () => {
    const { session, store } = storeWith(pendingRespond);

    await store.decide({
      workspaceId: WORKSPACE_ID,
      actorId: ACTOR_ID,
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      approve: true,
    });

    expect(session.ran('DELETE FROM device_approval_attempt')).toBe(true);
  });
});

describe('redeeming a device code for a token', () => {
  const approvedRespond: Responder = (sql) => {
    if (sql.includes('SELECT id, status, claimed_workspace_id')) {
      return [
        {
          id: AUTHORIZATION_ID,
          status: 'approved',
          claimed_workspace_id: WORKSPACE_ID,
          claimed_actor_id: ACTOR_ID,
        },
      ];
    }
    if (sql.includes('UPDATE device_authorization')) return [{ id: AUTHORIZATION_ID }];
    return [];
  };

  it('reads the claimed workspace from the row rather than trusting the caller', async () => {
    const { session, store } = storeWith(approvedRespond);

    const redeemed = await store.redeem({
      deviceCodeHash: 'hash-a',
      tokenHash: 'token-hash',
      label: 'mneia login',
    });

    expect(redeemed).toEqual({ workspaceId: WORKSPACE_ID, actorId: ACTOR_ID });
    const settings = session.settingsBefore("SET status = 'redeemed'");
    expect(settings.get(WORKSPACE_SETTING)).toBe(WORKSPACE_ID);
    expect(settings.get(DEVICE_CODE_HASH_SETTING)).toBe('hash-a');
  });

  it('mints the token into the claimed workspace, not into a caller supplied one', async () => {
    const { session, store } = storeWith(approvedRespond);

    await store.redeem({ deviceCodeHash: 'hash-a', tokenHash: 'token-hash', label: 'mneia login' });

    const insert = session.exchanges.find((e) => e.sql.includes('INSERT INTO api_token'));
    expect(insert?.params[1]).toBe(WORKSPACE_ID);
    expect(insert?.params[2]).toBe(ACTOR_ID);
    expect(insert?.params[3]).toBe('token-hash');
  });

  it('reports a pending authorization as pending rather than minting anything', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('SELECT id, status, claimed_workspace_id')) {
        return [
          {
            id: AUTHORIZATION_ID,
            status: 'pending',
            claimed_workspace_id: null,
            claimed_actor_id: null,
          },
        ];
      }
      return [];
    });

    await expect(
      store.redeem({ deviceCodeHash: 'hash-a', tokenHash: 'token-hash', label: '' }),
    ).rejects.toMatchObject({ code: 'authorization_pending' });
    expect(session.ran('INSERT INTO api_token')).toBe(false);
  });

  it('refuses a denied authorization', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('SELECT id, status, claimed_workspace_id')) {
        return [
          {
            id: AUTHORIZATION_ID,
            status: 'denied',
            claimed_workspace_id: WORKSPACE_ID,
            claimed_actor_id: ACTOR_ID,
          },
        ];
      }
      return [];
    });

    await expect(
      store.redeem({ deviceCodeHash: 'hash-a', tokenHash: 'token-hash', label: '' }),
    ).rejects.toMatchObject({ code: 'authorization_denied' });
    expect(session.ran('INSERT INTO api_token')).toBe(false);
  });

  it('refuses to mint a second token for a code already exchanged', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('SELECT id, status, claimed_workspace_id')) {
        return [
          {
            id: AUTHORIZATION_ID,
            status: 'redeemed',
            claimed_workspace_id: WORKSPACE_ID,
            claimed_actor_id: ACTOR_ID,
          },
        ];
      }
      return [];
    });

    await expect(
      store.redeem({ deviceCodeHash: 'hash-a', tokenHash: 'token-hash', label: '' }),
    ).rejects.toMatchObject({ code: 'already_redeemed' });
    expect(session.ran('INSERT INTO api_token')).toBe(false);
  });

  it('does not mint when the redeeming update matches no row, which is the concurrent redemption', async () => {
    const { session, store } = storeWith((sql) => {
      if (sql.includes('SELECT id, status, claimed_workspace_id')) {
        return [
          {
            id: AUTHORIZATION_ID,
            status: 'approved',
            claimed_workspace_id: WORKSPACE_ID,
            claimed_actor_id: ACTOR_ID,
          },
        ];
      }
      if (sql.includes('UPDATE device_authorization')) return [];
      return [];
    });

    await expect(
      store.redeem({ deviceCodeHash: 'hash-a', tokenHash: 'token-hash', label: '' }),
    ).rejects.toMatchObject({ code: 'already_redeemed' });
    expect(session.ran('INSERT INTO api_token')).toBe(false);
    expect(session.ran('ROLLBACK')).toBe(true);
  });
});

describe('identifying a bearer token', () => {
  const identified: Responder = (sql) => {
    if (sql.includes('SELECT id, workspace_id, actor_id FROM api_token')) {
      return [{ id: NEW_ID, workspace_id: WORKSPACE_ID, actor_id: ACTOR_ID }];
    }
    if (sql.includes('workspace_name')) {
      return [
        {
          workspace_name: 'Ascend',
          workspace_slug: 'ascend',
          actor_name: 'Ada Lovelace',
          actor_kind: 'human',
          team_id: TEAM_ID,
          team_name: 'Default',
        },
      ];
    }
    return [];
  };

  it('looks the token up with the workspace blank, which is what the bearer policy requires', async () => {
    const { session, store } = storeWith(identified);

    await store.identify('token-hash');

    const settings = session.settingsBefore('SELECT id, workspace_id, actor_id FROM api_token');
    expect(settings.get(API_TOKEN_HASH_SETTING)).toBe('token-hash');
    expect(settings.get(WORKSPACE_SETTING)).toBe('');
  });

  it('scopes to the resolved workspace before reading anything about it', async () => {
    const { session, store } = storeWith(identified);

    const identity = await store.identify('token-hash');

    expect(identity.workspaceName).toBe('Ascend');
    expect(identity.actorKind).toBe('human');
    const settings = session.settingsBefore('workspace_name');
    expect(settings.get(WORKSPACE_SETTING)).toBe(WORKSPACE_ID);
  });

  it('rejects a token that matches no live row, which is how revocation and expiry surface', async () => {
    const { store } = storeWith(() => []);

    await expect(store.identify('token-hash')).rejects.toMatchObject({ code: 'unknown_token' });
  });

  it('never selects the token hash back out', async () => {
    const { session, store } = storeWith(identified);

    await store.identify('token-hash');

    const selects = session.exchanges.filter((e) => e.sql.includes('SELECT'));
    for (const select of selects) {
      expect(select.sql).not.toMatch(/token_hash/);
    }
  });
});

describe('transaction discipline', () => {
  it('releases the connection on the happy path', async () => {
    const { session, store } = storeWith(() => []);

    await store.start({
      deviceCodeHash: 'hash-a',
      userCode: 'BCDF-GHJK',
      confirmationCode: '0417',
      clientLabel: '',
      lifetimeSeconds: 900,
    });

    expect(session.ran('COMMIT')).toBe(true);
    expect(session.released).toBe(1);
    expect(session.discarded).toBe(0);
  });

  it('rolls back and still releases when the operation throws', async () => {
    const session = new FakeSession((sql) => {
      if (sql.includes('INSERT INTO device_authorization')) throw new Error('duplicate user_code');
      return [];
    });
    const store = new PostgresDeviceStore(sourceOf(session), () => NEW_ID);

    await expect(
      store.start({
        deviceCodeHash: 'hash-a',
        userCode: 'BCDF-GHJK',
        confirmationCode: '0417',
        clientLabel: '',
        lifetimeSeconds: 900,
      }),
    ).rejects.toThrow('duplicate user_code');

    expect(session.ran('ROLLBACK')).toBe(true);
    expect(session.released).toBe(1);
  });

  it('discards rather than returns a connection whose rollback failed', async () => {
    const session = new FakeSession((sql) => {
      if (sql.includes('INSERT INTO device_authorization')) throw new Error('write failed');
      if (sql === 'ROLLBACK') throw new Error('connection reset');
      return [];
    });
    const store = new PostgresDeviceStore(sourceOf(session), () => NEW_ID);

    await expect(
      store.start({
        deviceCodeHash: 'hash-a',
        userCode: 'BCDF-GHJK',
        confirmationCode: '0417',
        clientLabel: '',
        lifetimeSeconds: 900,
      }),
    ).rejects.toBeInstanceOf(DeviceError);

    expect(session.discarded).toBe(1);
    expect(session.released).toBe(0);
  });
});
