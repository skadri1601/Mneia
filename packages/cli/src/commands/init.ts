import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
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
  AGENTS_FILE,
  assertFenceIntact,
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
}

const USAGE =
  'mneia init [--workspace <slug>] [--project <slug>] [--endpoint <url>] [--force] [--json]';

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
    ]),
    '',
    'Next: mneia brief "<what you are about to work on>"',
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
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function configFileFor(attach: AttachResult, endpoint: string | null): ProjectConfigFile {
  const base = { workspace: attach.workspace, project: attach.project };
  return endpoint === null ? base : { ...base, endpoint };
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
      assertFenceIntact((await readTextFile(agentsPath)) ?? '', agentsPath);

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

      await writeProjectConfig(invocation.io.cwd, configFileFor(attach, persistedEndpoint));

      const writeBack = await writeGeneratedSection(
        agentsPath,
        renderGeneratedSection({
          workspace: attach.workspace,
          project: attach.project,
          endpoint,
          constraintsImported: attach.constraintsImported,
          sources: imported.sources,
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
      };

      invocation.io.stdout(invocation.json ? renderJson(outcome) : renderHuman(outcome));
      return EXIT_OK;
    },
  };
}

const unwiredApi: InitApi = {
  attach: () =>
    Promise.reject(
      new CliError(
        'failed',
        'the hosted Mneia API client is not wired into this build yet',
        'the hosted API lands with MNE-101; there is nothing to fix locally',
      ),
    ),
};

export const initCommand: CommandDefinition = createInitCommand({
  api: unwiredApi,
  loadConfig: (cwd, env) => loadProjectConfig(cwd, env),
  resolveToken: (env) => resolveToken(env),
});
