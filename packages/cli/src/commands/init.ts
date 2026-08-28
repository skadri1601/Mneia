import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { VERSION } from '@mneia/core';
import { CliError, type CommandDefinition, type CommandInvocation, EXIT_OK } from '../command.js';
import {
  CONFIG_DIR,
  configPathFor,
  DEFAULT_ENDPOINT,
  ENDPOINT_ENV_VAR,
  loadProjectConfig,
  type ProjectConfig,
  type ProjectConfigFile,
  resolveToken,
} from '../config.js';
import {
  detectHookRuntime,
  HOOK_CLIENTS,
  HOOK_CLIENT_SPECS,
  type HookClient,
  type HookInstallOutcome,
  type HookRuntime,
  installSessionStartHook,
} from '../hooks-config.js';
import { httpInitApi } from '../http-api.js';
import {
  AGENTS_FILE,
  assertFenceIntact,
  assertGeneratedSectionUnedited,
  type ImportedConstraint,
  importConstraints,
  readTextFile,
  renderGeneratedSection,
  type WriteBackResult,
  writeGeneratedSection,
} from '../interop.js';

export interface AttachRequest {
  readonly workspace: string | null;
  readonly project: string;
  readonly endpoint: string;
  readonly token: string;
  readonly repoRoot: string;
  readonly constraints: readonly ImportedConstraint[];
}

export interface AttachResult {
  readonly workspace: string;
  readonly project: string;
  readonly created: boolean;
  readonly constraintsImported: number;
}

export interface InitApi {
  readonly attach: (request: AttachRequest) => Promise<AttachResult>;
}

export type ExistingConfigLoader = (
  cwd: string,
  env: Readonly<Record<string, string | undefined>>,
) => Promise<ProjectConfig | null> | ProjectConfig | null;

export type TokenResolver = (
  env: Readonly<Record<string, string | undefined>>,
) => Promise<string> | string;

export interface InitDeps {
  readonly api: InitApi;
  readonly loadConfig: ExistingConfigLoader;
  readonly resolveToken: TokenResolver;
  readonly now?: (() => Date) | undefined;
  /** How the running CLI will be reachable from a future session. See HookRuntime. */
  readonly hookRuntime?: HookRuntime | undefined;
}

const USAGE =
  'mneia init [--workspace <slug>] [--project <slug>] [--endpoint <url>] [--force] [--no-hooks] [--json]';

const SLUG = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/;

const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function usageError(message: string): CliError {
  return new CliError('usage', message, `usage: ${USAGE}`);
}

function readStringFlag(flags: CommandInvocation['flags'], name: string): string | null {
  const raw = flags[name];
  if (raw === undefined) {
    return null;
  }
  if (typeof raw !== 'string') {
    throw usageError(`--${name} needs a value`);
  }
  const value = raw.trim();
  if (value.length === 0) {
    throw usageError(`--${name} needs a value`);
  }
  return value;
}

function readForce(flags: CommandInvocation['flags']): boolean {
  const raw = flags.force;
  if (raw === undefined || raw === 'false') {
    return false;
  }
  if (raw === true || raw === 'true') {
    return true;
  }
  throw usageError('--force is a switch and takes no value');
}

function readSlugFlag(flags: CommandInvocation['flags'], name: string): string | null {
  const value = readStringFlag(flags, name);
  if (value === null) {
    return null;
  }
  if (!SLUG.test(value)) {
    throw new CliError(
      'usage',
      `--${name} expects a slug of lowercase letters, digits, and single - _ . separators; got "${value}"`,
      `pass --${name} ${slugify(value) || '<slug>'}`,
    );
  }
  return value;
}

function readEndpointFlag(flags: CommandInvocation['flags']): string | null {
  const value = readStringFlag(flags, 'endpoint');
  if (value === null) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw usageError(`--endpoint expects an absolute URL; got "${value}"`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw usageError(`--endpoint expects an http or https URL; got "${value}"`);
  }
  return value;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function deriveProjectSlug(repoRoot: string): string {
  const name = basename(repoRoot);
  const slug = slugify(name);
  if (slug.length === 0) {
    throw new CliError(
      'usage',
      `could not derive a project slug from the directory name "${name}"`,
      'name the project yourself with --project <slug>',
    );
  }
  return slug;
}

async function readExistingConfig(
  deps: InitDeps,
  invocation: CommandInvocation,
  force: boolean,
): Promise<ProjectConfig | null> {
  try {
    return await deps.loadConfig(invocation.io.cwd, invocation.io.env);
  } catch (error) {
    if (!(error instanceof CliError)) {
      throw error;
    }
    if (force) {
      return null;
    }
    throw new CliError(
      error.kind,
      error.message,
      `${error.fix}, or run mneia init --force to overwrite it`,
    );
  }
}

function assertNoRebind(
  existing: ProjectConfig | null,
  workspace: string | null,
  project: string | null,
): void {
  if (existing === null) {
    return;
  }
  const conflicts =
    (workspace !== null && workspace !== existing.workspace) ||
    (project !== null && project !== existing.project);

  if (!conflicts) {
    return;
  }
  throw new CliError(
    'failed',
    `${existing.configPath} already binds this repo to ${existing.workspace}/${existing.project}`,
    'run mneia init --force to rebind it, or drop the flags to keep the current binding',
  );
}

async function readPersistedEndpoint(configPath: string): Promise<string | null> {
  const raw = await readTextFile(configPath);
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || !('endpoint' in parsed)) {
    return null;
  }
  const endpoint = (parsed as { endpoint?: unknown }).endpoint;
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null;
}

function causeCodes(error: unknown): readonly string[] {
  const codes: string[] = [];
  let current: unknown = error;

  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      codes.push(code);
    }
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch failed')) {
    return true;
  }
  return causeCodes(error).some((code) => NETWORK_ERROR_CODES.has(code));
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function callApi<T>(endpoint: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    if (isNetworkFailure(error)) {
      throw new CliError(
        'network',
        `could not reach the Mneia API at ${endpoint}: ${describeError(error)}`,
        'check your network connection or VPN, then run mneia init again — your token was not the problem',
      );
    }
    throw new CliError(
      'failed',
      `the Mneia API could not attach this repo: ${describeError(error)}`,
      'retry, and report it if it keeps failing',
    );
  }
}

async function writeProjectConfig(cwd: string, file: ProjectConfigFile): Promise<string> {
  const path = configPathFor(cwd);
  try {
    await mkdir(join(resolve(cwd), CONFIG_DIR), { recursive: true });
    await writeFile(path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  } catch (cause) {
    throw new CliError(
      'failed',
      `could not write ${path}: ${describeError(cause)}`,
      'check the file permissions on the repository root, then run mneia init again',
    );
  }
  return path;
}

interface InitOutcome {
  readonly attach: AttachResult;
  readonly endpoint: string;
  readonly configPath: string;
  readonly repoRoot: string;
  readonly agentsPath: string;
  readonly writeBack: WriteBackResult;
  readonly sources: readonly string[];
  readonly hooks: readonly HookInstallOutcome[];
  readonly hooksSkipped: string | null;
  readonly hookRuntime: HookRuntime;
}

const WRITE_BACK_TEXT: Readonly<Record<WriteBackResult, string>> = {
  created: 'created, with the generated section',
  updated: 'generated section updated',
  unchanged: 'generated section already current',
};

function renderRows(rows: readonly (readonly [string, string])[]): string[] {
  const width = rows.reduce((longest, [label]) => Math.max(longest, label.length), 0);
  return rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`);
}

function describeConstraints(outcome: InitOutcome): string {
  const count = outcome.attach.constraintsImported;
  const noun = count === 1 ? 'constraint' : 'constraints';
  if (outcome.sources.length === 0) {
    return 'none — this repo has no AGENTS.md, CLAUDE.md, or .cursor/rules to read';
  }
  return `${count} ${noun} from ${outcome.sources.join(', ')}`;
}

/**
 * Which harnesses will now load project memory on their own, in one line.
 *
 * Named rather than counted: the whole promise of this step is that the user does not have
 * to remember to rehydrate, and a bare "3 clients" does not tell them whether the one they
 * actually use is among them.
 */
function describeHooks(outcome: InitOutcome): string {
  if (outcome.hooksSkipped !== null) {
    return `not installed — ${outcome.hooksSkipped}`;
  }
  const installed = outcome.hooks.filter((hook) => hook.result !== 'unchanged');
  const labels = outcome.hooks.map((hook) => HOOK_CLIENT_SPECS[hook.client].label);
  // Said out loud, because it is the difference between a hook that runs a binary already
  // on PATH and one that resolves a package first. The user chose npx and can undo it.
  const via = outcome.hookRuntime.ephemeral
    ? ` (through npx @mneia/cli@${outcome.hookRuntime.version} — install the CLI to drop that step)`
    : '';
  if (installed.length === 0) {
    return `already configured for ${labels.join(', ')}${via}`;
  }
  return `${labels.join(', ')} now rehydrate automatically${via}`;
}

function renderHuman(outcome: InitOutcome): string {
  const name = `${outcome.attach.workspace}/${outcome.attach.project}`;
  const headline = outcome.attach.created
    ? `Bound this repo to the Mneia project ${name}.`
    : `This repo is already bound to the Mneia project ${name}.`;

  const lines = [
    headline,
    '',
    ...renderRows([
      ['config', relative(outcome.repoRoot, outcome.configPath) || outcome.configPath],
      ['endpoint', outcome.endpoint],
      ['imported', describeConstraints(outcome)],
      [AGENTS_FILE, WRITE_BACK_TEXT[outcome.writeBack]],
      ['session start', describeHooks(outcome)],
    ]),
    '',
    'Next: just start your agent. It loads this project memory on its own.',
  ];
  return `${lines.join('\n')}\n`;
}

function renderJson(outcome: InitOutcome): string {
  const payload = {
    ok: true,
    command: 'init',
    workspace: outcome.attach.workspace,
    project: outcome.attach.project,
    endpoint: outcome.endpoint,
    created: outcome.attach.created,
    configPath: outcome.configPath,
    constraintsImported: outcome.attach.constraintsImported,
    sources: outcome.sources,
    agentsFile: { path: outcome.agentsPath, result: outcome.writeBack },
    sessionStartHooks: outcome.hooks.map((hook) => ({
      client: hook.client,
      path: hook.path,
      result: hook.result,
    })),
    sessionStartHooksSkipped: outcome.hooksSkipped,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function configFileFor(
  attach: AttachResult,
  endpoint: string | null,
  boundAt: Date | null,
): ProjectConfigFile {
  const base = { workspace: attach.workspace, project: attach.project };
  const dated = boundAt === null ? base : { ...base, boundAt: boundAt.toISOString() };
  return endpoint === null ? dated : { ...dated, endpoint };
}

/**
 * When this binding says it began, or null to leave that unrecorded.
 *
 * Three cases, and conflating the last two is what makes the gate dangerous:
 *
 * - No config yet — this is a new binding, so stamp it now.
 * - A config that already carries boundAt — keep it. Restamping on a re-init would move
 *   the eligibility line forward and drop every session run since the repo was first bound,
 *   including the ones a --force rebind is meant to preserve.
 * - A config written before boundAt existed — leave it absent. Stamping one now would tell
 *   the gate that every session this long-standing user has ever run predates the binding,
 *   silently excluding all of them. Absent means "sweep as before", which is the compatible
 *   answer; they opt in by binding a new repo.
 */
function boundAtFor(existing: ProjectConfig | null, now: () => Date): Date | null {
  if (existing === null) {
    return now();
  }
  return existing.boundAt;
}

/**
 * Installs the session-start hook for every supported harness, not only the ones detected.
 *
 * A config for a harness nobody has installed is inert - the file is read by that harness
 * or by nothing at all - whereas detecting at init time gets it wrong the moment a
 * teammate who uses a different agent clones the repo. Writing all three is the option
 * that does not require anyone to re-run setup.
 *
 * A single client failing is reported and the rest still install: a permissions problem on
 * one dotfile is not a reason to leave the other two harnesses without memory.
 */
async function installHooks(
  repoRoot: string,
  flags: CommandInvocation['flags'],
  runtime: HookRuntime,
): Promise<{ hooks: readonly HookInstallOutcome[]; hooksSkipped: string | null }> {
  if (flags['no-hooks'] === true || flags['no-hooks'] === 'true') {
    return { hooks: [], hooksSkipped: '--no-hooks was passed' };
  }

  const installed: HookInstallOutcome[] = [];
  const failures: string[] = [];
  for (const client of HOOK_CLIENTS) {
    try {
      installed.push(await installSessionStartHook(repoRoot, client as HookClient, runtime));
    } catch (cause) {
      failures.push(`${client}: ${describeError(cause)}`);
    }
  }

  return {
    hooks: installed,
    hooksSkipped: failures.length === 0 ? null : failures.join('; '),
  };
}

export function createInitCommand(deps: InitDeps): CommandDefinition {
  return {
    name: 'init',
    summary: 'Attach this repo to a Mneia project and import its existing constraints.',
    usage: USAGE,
    async run(invocation: CommandInvocation): Promise<number> {
      if (invocation.args.length > 0) {
        throw usageError(
          `mneia init takes no positional arguments; got "${invocation.args.join(' ')}"`,
        );
      }

      const repoRoot = resolve(invocation.io.cwd);
      const force = readForce(invocation.flags);
      const requestedWorkspace = readSlugFlag(invocation.flags, 'workspace');
      const requestedProject = readSlugFlag(invocation.flags, 'project');
      const endpointFlag = readEndpointFlag(invocation.flags);

      const existing = await readExistingConfig(deps, invocation, force);
      if (!force) {
        assertNoRebind(existing, requestedWorkspace, requestedProject);
      }

      const configPath = configPathFor(invocation.io.cwd);
      const persistedEndpoint = endpointFlag ?? (await readPersistedEndpoint(configPath));
      const endpoint =
        endpointFlag ??
        invocation.io.env[ENDPOINT_ENV_VAR] ??
        persistedEndpoint ??
        DEFAULT_ENDPOINT;

      const imported = await importConstraints(repoRoot);

      const agentsPath = join(repoRoot, AGENTS_FILE);
      const agentsText = (await readTextFile(agentsPath)) ?? '';
      if (force) {
        assertFenceIntact(agentsText, agentsPath);
      } else {
        assertGeneratedSectionUnedited(agentsText, agentsPath);
      }

      const token = await deps.resolveToken(invocation.io.env);
      const attach = await callApi(endpoint, () =>
        deps.api.attach({
          workspace: requestedWorkspace ?? existing?.workspace ?? null,
          project: requestedProject ?? existing?.project ?? deriveProjectSlug(repoRoot),
          endpoint,
          token,
          repoRoot,
          constraints: imported.constraints,
        }),
      );

      await writeProjectConfig(
        invocation.io.cwd,
        configFileFor(
          attach,
          persistedEndpoint,
          boundAtFor(existing ?? null, deps.now ?? (() => new Date())),
        ),
      );

      // Installed before the section is written, not after, because the section now states
      // whether rehydration is automatic here. Rendering that from an intention rather than
      // from an outcome is what told every agent in a --no-hooks repository that there was
      // nothing to run by hand.
      const hookRuntime =
        deps.hookRuntime ?? detectHookRuntime(process.argv[1], VERSION, invocation.io.env);
      const { hooks, hooksSkipped } = await installHooks(repoRoot, invocation.flags, hookRuntime);

      const writeBack = await writeGeneratedSection(
        agentsPath,
        renderGeneratedSection({
          workspace: attach.workspace,
          project: attach.project,
          endpoint,
          constraintsImported: attach.constraintsImported,
          sources: imported.sources,
          sessionStartHooks: hooks.map((hook) => HOOK_CLIENT_SPECS[hook.client].label),
        }),
      );

      const outcome: InitOutcome = {
        attach,
        endpoint,
        configPath,
        repoRoot,
        agentsPath,
        writeBack,
        sources: imported.sources,
        hooks,
        hooksSkipped,
        hookRuntime,
      };

      invocation.io.stdout(invocation.json ? renderJson(outcome) : renderHuman(outcome));
      return EXIT_OK;
    },
  };
}

export const initCommand: CommandDefinition = createInitCommand({
  api: httpInitApi,
  loadConfig: (cwd, env) => loadProjectConfig(cwd, env),
  resolveToken: (env) => resolveToken(env),
});
