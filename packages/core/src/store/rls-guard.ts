import type { SqlExecutor } from './driver.js';

export const RLS_BYPASS_ESCAPE_HATCH = 'MNEIA_ALLOW_RLS_BYPASS';

export interface RlsPosture {
  readonly role: string;
  readonly sessionRole: string;
  readonly isSuperuser: boolean;
  readonly bypassesRls: boolean;
  readonly viaRoles: readonly string[];
}

export type RlsGuardErrorCode = 'bypasses_rls' | 'unreadable_posture';

export class RlsGuardError extends Error {
  readonly code: RlsGuardErrorCode;
  readonly posture: RlsPosture | null;

  constructor(code: RlsGuardErrorCode, message: string, posture: RlsPosture | null = null) {
    super(message);
    this.name = 'RlsGuardError';
    this.code = code;
    this.posture = posture;
  }
}

export const RLS_POSTURE_SQL = `
SELECT
  connected.rolname::text                AS role_name,
  session_user::text                     AS session_role_name,
  connected.rolsuper                     AS role_is_superuser,
  connected.rolbypassrls                 AS role_bypasses_rls,
  granting.rolname::text                 AS granting_role,
  COALESCE(granting.rolsuper, false)     AS granting_is_superuser,
  COALESCE(granting.rolbypassrls, false) AS granting_bypasses_rls
FROM pg_catalog.pg_roles connected
LEFT JOIN pg_catalog.pg_roles granting
  ON (granting.rolsuper OR granting.rolbypassrls)
 AND pg_catalog.pg_has_role(current_user, granting.oid, 'MEMBER')
WHERE connected.rolname = current_user
ORDER BY granting.rolname
`;

interface PostureRow {
  readonly role_name: unknown;
  readonly session_role_name: unknown;
  readonly role_is_superuser: unknown;
  readonly role_bypasses_rls: unknown;
  readonly granting_role: unknown;
  readonly granting_is_superuser: unknown;
  readonly granting_bypasses_rls: unknown;
}

const quoted = (name: string): string => `"${name}"`;

const unreadable = (expected: string, found: unknown): RlsGuardError =>
  new RlsGuardError(
    'unreadable_posture',
    `expected the row-level security posture query to return ${expected}; found ${JSON.stringify(found) ?? String(found)}. ` +
      'Refusing the connection: the guard cannot confirm that RLS applies to it, and will not assume it does.',
  );

const readRoleName = (value: unknown, column: string): string => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  throw unreadable(`a role name in "${column}"`, value);
};

const readBoolean = (value: unknown, column: string): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 't' || value === 'true') {
    return true;
  }
  if (value === 'f' || value === 'false') {
    return false;
  }
  throw unreadable(`a boolean in "${column}"`, value);
};

export async function inspectRlsPosture(sql: SqlExecutor): Promise<RlsPosture> {
  const result = await sql.execute<PostureRow>(RLS_POSTURE_SQL);
  const [first] = result.rows;

  if (first === undefined) {
    throw unreadable('one row describing the connected role', result.rows);
  }

  const role = readRoleName(first.role_name, 'role_name');
  const sessionRole = readRoleName(first.session_role_name, 'session_role_name');

  let isSuperuser = readBoolean(first.role_is_superuser, 'role_is_superuser');
  let bypassesRls = readBoolean(first.role_bypasses_rls, 'role_bypasses_rls');
  const viaRoles: string[] = [];

  for (const row of result.rows) {
    if (row.granting_role === null || row.granting_role === undefined) {
      continue;
    }

    const granting = readRoleName(row.granting_role, 'granting_role');

    if (readBoolean(row.granting_is_superuser, 'granting_is_superuser')) {
      isSuperuser = true;
    }
    if (readBoolean(row.granting_bypasses_rls, 'granting_bypasses_rls')) {
      bypassesRls = true;
    }
    if (!viaRoles.includes(granting)) {
      viaRoles.push(granting);
    }
  }

  bypassesRls = bypassesRls || isSuperuser;

  if (bypassesRls && viaRoles.length === 0) {
    viaRoles.push(role);
  }

  return { role, sessionRole, isSuperuser, bypassesRls, viaRoles };
}

function describeBypass(posture: RlsPosture): string {
  const conferring = posture.viaRoles.length > 0 ? posture.viaRoles : [posture.role];
  const attribute = posture.isSuperuser ? 'SUPERUSER' : 'BYPASSRLS';
  const inherited = conferring.filter((name) => name !== posture.role);

  const lines = [
    `expected DATABASE_URL to name a role that Postgres row-level security applies to; found ${quoted(posture.role)}, which bypasses it — ${attribute} via ${conferring.map(quoted).join(', ')}.`,
    "Every workspace_isolation policy in this store is inert on this connection, so one workspace can read and write another's rows (vision.md §11.3).",
    'Fix it by connecting as a dedicated application role:',
    "  CREATE ROLE mneia_app LOGIN PASSWORD '<secret>' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;",
    '  GRANT USAGE ON SCHEMA public TO mneia_app;',
    '  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mneia_app;',
    '  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mneia_app;',
    'then point DATABASE_URL at it.',
    `Revoking in place is the alternative: ALTER ROLE ${quoted(posture.role)} NOSUPERUSER NOBYPASSRLS;`,
  ];

  if (inherited.length > 0) {
    lines.push(
      `  and REVOKE ${inherited.map(quoted).join(', ')} FROM ${quoted(posture.role)}; — membership in those roles confers the bypass on its own.`,
    );
  }

  if (posture.sessionRole !== posture.role) {
    lines.push(
      `This session logged in as ${quoted(posture.sessionRole)} and SET ROLE to ${quoted(posture.role)}; the guard reports the current role.`,
    );
  }

  lines.push(
    `Migrations legitimately run as a privileged role — set ${RLS_BYPASS_ESCAPE_HATCH}=1 for that one command, never for the application.`,
  );

  return lines.join('\n');
}

export function assertRlsEnforced(posture: RlsPosture): void {
  if (!posture.bypassesRls) {
    return;
  }

  if (process.env[RLS_BYPASS_ESCAPE_HATCH] === '1') {
    console.warn(
      `${RLS_BYPASS_ESCAPE_HATCH}=1: proceeding on ${quoted(posture.role)}, which bypasses row-level security via ${posture.viaRoles.map(quoted).join(', ')}. Workspace isolation is not enforced on this connection.`,
    );
    return;
  }

  throw new RlsGuardError('bypasses_rls', describeBypass(posture), posture);
}

export async function assertConnectionEnforcesRls(sql: SqlExecutor): Promise<void> {
  assertRlsEnforced(await inspectRlsPosture(sql));
}
