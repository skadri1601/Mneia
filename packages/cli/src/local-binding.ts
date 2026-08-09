import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { CliError } from './command.js';
import { mneiaHomeDir } from './config.js';

export const LOCAL_CONFIG_FILE = 'local.json';
export const LOCAL_CONFIG_ENV_VAR = 'MNEIA_LOCAL_CONFIG';

const localBindingSchema = z.object({
  workspaceId: z.string().uuid(),
  humanActorId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  projectSlug: z.string().min(1).nullable().optional(),
});

export interface LocalBinding {
  readonly workspaceId: string;
  readonly humanActorId: string;
  readonly projectId: string | null;
  readonly projectSlug: string | null;
  readonly configPath: string;
}

export function localConfigPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const override = env[LOCAL_CONFIG_ENV_VAR];
  if (override !== undefined && override.length > 0 && isAbsolute(override)) {
    return override;
  }
  return join(mneiaHomeDir(env), LOCAL_CONFIG_FILE);
}

export async function loadLocalBinding(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<LocalBinding | null> {
  const path = localConfigPath(env);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    if (typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT') {
      return null;
    }
    throw new CliError(
      'failed',
      `could not read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      `check the file permissions on ${path}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new CliError(
      'not_configured',
      `${path} is not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      'fix the JSON, or delete the file and run pnpm bootstrap:local --apply again',
    );
  }

  const result = localBindingSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new CliError(
      'not_configured',
      `${path} is not a valid Mneia local binding: ${detail}`,
      'run pnpm bootstrap:local --apply to write a correct one',
    );
  }

  return {
    workspaceId: result.data.workspaceId,
    humanActorId: result.data.humanActorId,
    projectId: result.data.projectId ?? null,
    projectSlug: result.data.projectSlug ?? null,
    configPath: path,
  };
}
