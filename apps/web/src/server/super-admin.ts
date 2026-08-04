import 'server-only';

import { auth } from '@clerk/nextjs/server';

export const SUPER_ADMIN_SUBJECTS_VAR = 'MNEIA_SUPER_ADMIN_SUBJECTS';

export const parseSuperAdminSubjects = (raw: string | undefined): ReadonlySet<string> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

export interface SuperAdminCheck {
  readonly subject: string | null;
  readonly allowed: ReadonlySet<string>;
}

export const isSuperAdmin = ({ subject, allowed }: SuperAdminCheck): boolean => {
  const candidate = subject?.trim();
  return candidate !== undefined && candidate.length > 0 && allowed.has(candidate);
};

export interface CurrentSuperAdminDependencies {
  readonly authenticate: () => Promise<{ readonly userId: string | null }>;
  readonly readAllowlist: () => string | undefined;
}

export const resolveIsSuperAdmin = async ({
  authenticate,
  readAllowlist,
}: CurrentSuperAdminDependencies): Promise<boolean> => {
  const { userId } = await authenticate();
  return isSuperAdmin({ subject: userId, allowed: parseSuperAdminSubjects(readAllowlist()) });
};

export const currentUserIsSuperAdmin = (): Promise<boolean> =>
  resolveIsSuperAdmin({
    authenticate: async () => {
      const { userId } = await auth();
      return { userId };
    },
    readAllowlist: () => process.env[SUPER_ADMIN_SUBJECTS_VAR],
  });
