import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const normaliseCwd = (value: string): string =>
  value
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/')
    .toLowerCase();

export function matchesCwd(candidate: string | null, requested: string | undefined): boolean {
  if (requested === undefined) {
    return true;
  }
  if (candidate === null) {
    return false;
  }
  const left = normaliseCwd(candidate);
  const right = normaliseCwd(requested);
  return left === right || left.startsWith(`${right}/`);
}

export function roamingAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === 'win32') {
    return env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support');
  }
  return env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

export function localAppDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === 'win32') {
    return env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  }
  if (platform() === 'darwin') {
    return join(homedir(), 'Library', 'Application Support');
  }
  return env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
}
