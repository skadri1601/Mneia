import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlExecutor, SqlResult } from './driver.js';
import {
  RLS_BYPASS_ESCAPE_HATCH,
  RLS_POSTURE_SQL,
  RlsGuardError,
  assertConnectionEnforcesRls,
  assertRlsEnforced,
  inspectRlsPosture,
} from './rls-guard.js';

class FakeExecutor implements SqlExecutor {
  readonly statements: string[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<TRow = Record<string, unknown>>(sql: string): Promise<SqlResult<TRow>> {
    this.statements.push(sql);
    return { rows: this.rows } as unknown as SqlResult<TRow>;
  }
}

interface GrantingRole {
  readonly name: string;
  readonly superuser?: boolean;
  readonly bypassrls?: boolean;
}

interface PostureFixture {
  readonly role?: string;
  readonly sessionRole?: string;
  readonly superuser?: boolean;
  readonly bypassrls?: boolean;
  readonly granting?: readonly GrantingRole[];
}

function rowsFor(fixture: PostureFixture = {}): Record<string, unknown>[] {
  const role = fixture.role ?? 'mneia_app';
  const base = {
    role_name: role,
    session_role_name: fixture.sessionRole ?? role,
    role_is_superuser: fixture.superuser ?? false,
    role_bypasses_rls: fixture.bypassrls ?? false,
  };
  const granting = fixture.granting ?? [];

  if (granting.length === 0) {
    return [
      {
        ...base,
        granting_role: null,
        granting_is_superuser: false,
        granting_bypasses_rls: false,
      },
    ];
  }

  return granting.map((role) => ({
    ...base,
    granting_role: role.name,
    granting_is_superuser: role.superuser ?? false,
    granting_bypasses_rls: role.bypassrls ?? false,
  }));
}

async function refusal(run: () => Promise<unknown>): Promise<RlsGuardError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RlsGuardError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected an RlsGuardError, but the guard allowed the connection');
}

describe('rls guard', () => {
  beforeEach(() => {
    vi.stubEnv(RLS_BYPASS_ESCAPE_HATCH, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('admits a role that holds neither attribute and inherits neither', async () => {
    const executor = new FakeExecutor(rowsFor({ role: 'mneia_app' }));

    const posture = await inspectRlsPosture(executor);

    expect(posture).toEqual({
      role: 'mneia_app',
      sessionRole: 'mneia_app',
      isSuperuser: false,
      bypassesRls: false,
      viaRoles: [],
    });
    await expect(assertConnectionEnforcesRls(new FakeExecutor(rowsFor()))).resolves.toBeUndefined();
  });

  it('refuses a superuser', async () => {
    const executor = new FakeExecutor(
      rowsFor({
        role: 'postgres',
        superuser: true,
        granting: [{ name: 'postgres', superuser: true }],
      }),
    );

    const error = await refusal(() => assertConnectionEnforcesRls(executor));

    expect(error.code).toBe('bypasses_rls');
    expect(error.posture?.isSuperuser).toBe(true);
    expect(error.posture?.bypassesRls).toBe(true);
    expect(error.message).toContain('SUPERUSER via "postgres"');
  });

  it('refuses a role holding BYPASSRLS directly', async () => {
    const executor = new FakeExecutor(
      rowsFor({
        role: 'neondb_owner',
        bypassrls: true,
        granting: [{ name: 'neondb_owner', bypassrls: true }],
      }),
    );

    const posture = await inspectRlsPosture(executor);

    expect(posture.isSuperuser).toBe(false);
    expect(posture.bypassesRls).toBe(true);
    expect(posture.viaRoles).toEqual(['neondb_owner']);
    expect(() => assertRlsEnforced(posture)).toThrow(RlsGuardError);
  });

  it('names the role even when the catalog reports the attribute without a granting row', async () => {
    const posture = await inspectRlsPosture(
      new FakeExecutor(rowsFor({ role: 'lonely', bypassrls: true })),
    );

    expect(posture.bypassesRls).toBe(true);
    expect(posture.viaRoles).toEqual(['lonely']);
  });

  it('refuses a role that only inherits BYPASSRLS through membership', async () => {
    const executor = new FakeExecutor(
      rowsFor({
        role: 'mneia_app',
        superuser: false,
        bypassrls: false,
        granting: [{ name: 'neon_superuser', bypassrls: true }],
      }),
    );

    const error = await refusal(() => assertConnectionEnforcesRls(executor));

    expect(error.code).toBe('bypasses_rls');
    expect(error.posture?.bypassesRls).toBe(true);
    expect(error.posture?.viaRoles).toEqual(['neon_superuser']);
    expect(error.message).toContain('BYPASSRLS via "neon_superuser"');
    expect(error.message).toContain('REVOKE "neon_superuser" FROM "mneia_app"');
  });

  it('refuses a role that inherits superuser transitively and reports every conferring role', async () => {
    const executor = new FakeExecutor(
      rowsFor({
        role: 'app',
        granting: [
          { name: 'admins', superuser: true },
          { name: 'readers', bypassrls: true },
        ],
      }),
    );

    const error = await refusal(() => assertConnectionEnforcesRls(executor));

    expect(error.posture?.isSuperuser).toBe(true);
    expect(error.posture?.viaRoles).toEqual(['admins', 'readers']);
    expect(error.message).toContain('SUPERUSER via "admins", "readers"');
  });

  it('tells the operator which role to change and how', async () => {
    const executor = new FakeExecutor(
      rowsFor({
        role: 'neondb_owner',
        bypassrls: true,
        granting: [{ name: 'neon_superuser', bypassrls: true }],
      }),
    );

    const error = await refusal(() => assertConnectionEnforcesRls(executor));

    expect(error.message).toContain('"neondb_owner"');
    expect(error.message).toContain('ALTER ROLE "neondb_owner" NOSUPERUSER NOBYPASSRLS');
    expect(error.message).toContain('CREATE ROLE mneia_app LOGIN');
    expect(error.message).toContain('NOBYPASSRLS');
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('§11.3');
  });

  it('reports the login role when the session has set role to something else', async () => {
    const executor = new FakeExecutor(
      rowsFor({ role: 'elevated', sessionRole: 'neondb_owner', bypassrls: true }),
    );

    const error = await refusal(() => assertConnectionEnforcesRls(executor));

    expect(error.posture?.sessionRole).toBe('neondb_owner');
    expect(error.message).toContain('logged in as "neondb_owner" and SET ROLE to "elevated"');
  });

  it('lets the explicit escape hatch through, loudly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubEnv(RLS_BYPASS_ESCAPE_HATCH, '1');

    const executor = new FakeExecutor(
      rowsFor({
        role: 'neondb_owner',
        bypassrls: true,
        granting: [{ name: 'neondb_owner', bypassrls: true }],
      }),
    );

    await expect(assertConnectionEnforcesRls(executor)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(RLS_BYPASS_ESCAPE_HATCH);
    expect(warn.mock.calls[0]?.[0]).toContain('"neondb_owner"');
  });

  it('honours the escape hatch only for exactly "1"', async () => {
    const posture = await inspectRlsPosture(
      new FakeExecutor(rowsFor({ role: 'neondb_owner', bypassrls: true })),
    );

    for (const value of ['0', 'true', 'yes', 'on', '', ' 1']) {
      vi.stubEnv(RLS_BYPASS_ESCAPE_HATCH, value);
      expect(() => assertRlsEnforced(posture)).toThrow(RlsGuardError);
    }
  });

  it('refuses rather than assumes when the posture cannot be read', async () => {
    const empty = await refusal(() => assertConnectionEnforcesRls(new FakeExecutor([])));
    expect(empty.code).toBe('unreadable_posture');

    const malformed = await refusal(() =>
      assertConnectionEnforcesRls(
        new FakeExecutor([
          {
            role_name: 'app',
            session_role_name: 'app',
            role_is_superuser: null,
            role_bypasses_rls: false,
            granting_role: null,
            granting_is_superuser: false,
            granting_bypasses_rls: false,
          },
        ]),
      ),
    );
    expect(malformed.code).toBe('unreadable_posture');
    expect(malformed.message).toContain('role_is_superuser');
  });

  it('reads the boolean forms a driver may hand back without parsing bool', async () => {
    const posture = await inspectRlsPosture(
      new FakeExecutor([
        {
          role_name: 'app',
          session_role_name: 'app',
          role_is_superuser: 'f',
          role_bypasses_rls: 't',
          granting_role: 'admins',
          granting_is_superuser: 'f',
          granting_bypasses_rls: 't',
        },
      ]),
    );

    expect(posture.bypassesRls).toBe(true);
    expect(posture.viaRoles).toEqual(['admins']);
  });

  it('asks the catalog about membership instead of trusting is_superuser', async () => {
    const executor = new FakeExecutor(rowsFor());

    await inspectRlsPosture(executor);

    expect(executor.statements).toEqual([RLS_POSTURE_SQL]);
    expect(RLS_POSTURE_SQL).toContain("pg_has_role(current_user, granting.oid, 'MEMBER')");
    expect(RLS_POSTURE_SQL).toContain('rolbypassrls');
    expect(RLS_POSTURE_SQL).toContain('rolsuper');
    expect(RLS_POSTURE_SQL).not.toContain('current_setting');
  });
});
