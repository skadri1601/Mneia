import 'server-only';

import { cookies } from 'next/headers';

export const WORKSPACE_COOKIE = 'mneia_workspace';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const readSelectedWorkspace = async (): Promise<string | null> => {
  const store = await cookies();
  const value = store.get(WORKSPACE_COOKIE)?.value;
  return value !== undefined && UUID.test(value) ? value : null;
};

export const writeSelectedWorkspace = async (workspaceId: string): Promise<void> => {
  const store = await cookies();
  store.set(WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ONE_YEAR_SECONDS,
  });
};
