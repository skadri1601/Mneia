import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CommandIo } from '../command.js';
import { EXIT_AUTH, EXIT_FAILED, EXIT_NETWORK, EXIT_OK, EXIT_USAGE } from '../command.js';
import { loadProjectConfig, resolveToken } from '../config.js';
import { FENCE_BEGIN, FENCE_END } from '../interop.js';
import { route } from '../router.js';
import { type AttachRequest, createInitCommand, type InitApi } from './init.js';

interface FakeApi extends InitApi {
  readonly requests: AttachRequest[];
  readonly projects: Set<string>;
}

function fakeApi(failure?: unknown): FakeApi {
  const requests: AttachRequest[] = [];
  const projects = new Set<string>();

  return {
    requests,
    projects,
    attach: async (request) => {
      requests.push(request);
      if (failure !== undefined) {
        throw failure;
      }
      const workspace = request.workspace ?? 'acme';
      const key = `${workspace}/${request.project}`;
      const created = !projects.has(key);
      projects.add(key);
      return {
        workspace,
        project: request.project,
        created,
        constraintsImported: request.constraints.length,
      };
    },
  };
}

interface RunResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

let root = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mne81-init-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function envWithToken(): Record<string, string | undefined> {
  return { MNEIA_TOKEN: 'device-flow-token' };
}

function envWithoutCredentials(): Record<string, string | undefined> {
  return { MNEIA_CREDENTIALS_PATH: join(root, 'nowhere', 'credentials') };
}

async function runInit(
  api: InitApi,
  argv: readonly string[] = [],
  env: Record<string, string | undefined> = envWithToken(),
): Promise<RunResult> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CommandIo = {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    cwd: root,
    env,
  };

  const code = await route({
    argv: ['init', ...argv],
    commands: [createInitCommand({ api, loadConfig: loadProjectConfig, resolveToken })],
    io,
    version: '0.0.0-test',
  });

  return { code, stdout: stdout.join(''), stderr: stderr.join('') };
}

async function write(relativePath: string, text: string): Promise<string> {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, text, 'utf8');
  return path;
}

async function exists(relativePath: string): Promise<boolean> {
  try {
    await access(join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('mneia init', () => {
  it('writes a config that config.ts reads back', async () => {
    const api = fakeApi();
    const result = await runInit(api, ['--workspace', 'acme', '--project', 'checkout']);

    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toContain('Bound this repo to the Mneia project acme/checkout.');

    const config = await loadProjectConfig(root, {});

    expect(config?.workspace).toBe('acme');
    expect(config?.project).toBe('checkout');
    expect(config?.endpoint).toBe('https://app.mneia.dev');
    expect(config?.repoRoot).toBe(root);
  });

  it('derives the project slug from the directory name when none is given', async () => {
    const api = fakeApi();
    await runInit(api);

    const config = await loadProjectConfig(root, {});

    expect(config?.project).toMatch(/^mne81-init-/);
    expect(api.requests[0]?.workspace).toBeNull();
  });

  it('is idempotent: a second run duplicates nothing and clobbers nothing', async () => {
    await write('AGENTS.md', '# Our repo\n\n- A human rule we care about\n');

    const api = fakeApi();
    const first = await runInit(api, ['--workspace', 'acme', '--project', 'checkout']);
    const configAfterFirst = await readFile(join(root, '.mneia', 'config.json'), 'utf8');
    const agentsAfterFirst = await readFile(join(root, 'AGENTS.md'), 'utf8');

    const second = await runInit(api, []);
    const configAfterSecond = await readFile(join(root, '.mneia', 'config.json'), 'utf8');
    const agentsAfterSecond = await readFile(join(root, 'AGENTS.md'), 'utf8');

    expect(first.code).toBe(EXIT_OK);
    expect(second.code).toBe(EXIT_OK);
    expect(configAfterSecond).toBe(configAfterFirst);
    expect(agentsAfterSecond).toBe(agentsAfterFirst);
    expect(api.projects.size).toBe(1);
    expect(second.stdout).toContain(
      'This repo is already bound to the Mneia project acme/checkout.',
    );
    expect(second.stdout).toContain('generated section already current');
    expect(occurrences(agentsAfterSecond, FENCE_BEGIN)).toBe(1);
    expect(occurrences(agentsAfterSecond, FENCE_END)).toBe(1);
    expect(agentsAfterSecond.startsWith('# Our repo\n\n- A human rule we care about\n')).toBe(true);
  });

  it('creates AGENTS.md when the repo has none', async () => {
    const api = fakeApi();
    const result = await runInit(api, ['--project', 'checkout']);

    expect(result.stdout).toContain('created, with the generated section');

    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');

    expect(agents.startsWith(FENCE_BEGIN)).toBe(true);
    expect(agents).toContain('mneia brief');
  });

  it('appends to an existing AGENTS.md without touching a byte of it', async () => {
    const original = '# Our repo\n\nHand written guidance nobody wants rewritten.\n';
    await write('AGENTS.md', original);

    await runInit(fakeApi(), ['--project', 'checkout']);
    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');

    expect(agents.startsWith(original)).toBe(true);
    expect(agents).toContain(FENCE_BEGIN);
  });

  it('imports constraints from AGENTS.md, CLAUDE.md, and .cursor/rules', async () => {
    await write('AGENTS.md', '- Never commit secrets\n');
    await write('CLAUDE.md', '- Ask before deploying to production\n');
    await write('.cursor/rules/style.mdc', '---\nglobs: "**/*.ts"\n---\n\n- No default exports\n');

    const api = fakeApi();
    const result = await runInit(api, ['--project', 'checkout']);
    const request = api.requests[0];

    expect(request?.constraints.map((constraint) => constraint.title)).toEqual([
      'Never commit secrets',
      'Ask before deploying to production',
      'No default exports',
    ]);
    expect(request?.token).toBe('device-flow-token');
    expect(result.stdout).toContain(
      'imported   3 constraints from AGENTS.md, CLAUDE.md, .cursor/rules/style.mdc',
    );
  });

  it('says so plainly when there is nothing to import', async () => {
    const result = await runInit(fakeApi(), ['--project', 'checkout']);

    expect(result.stdout).toContain(
      'none — this repo has no AGENTS.md, CLAUDE.md, or .cursor/rules',
    );
  });
});

describe('mneia init failure modes', () => {
  it('reads an unreachable API as a network failure, not an auth failure', async () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND api.mneia.dev'), {
      code: 'ENOTFOUND',
    });
    const result = await runInit(fakeApi(new TypeError('fetch failed', { cause })));

    expect(result.code).toBe(EXIT_NETWORK);
    expect(result.stderr).toContain('could not reach the Mneia API at https://app.mneia.dev');
    expect(result.stderr).toContain('your token was not the problem');
    expect(result.stderr).not.toContain('token is invalid');
    expect(await exists('.mneia/config.json')).toBe(false);
    expect(await exists('AGENTS.md')).toBe(false);
  });

  it('reads a missing credential as an auth failure and names the fix', async () => {
    const api = fakeApi();
    const result = await runInit(api, [], envWithoutCredentials());

    expect(result.code).toBe(EXIT_AUTH);
    expect(result.stderr).toContain('no Mneia credentials found');
    expect(result.stderr).toContain('run mneia login');
    expect(api.requests).toHaveLength(0);
    expect(await exists('.mneia/config.json')).toBe(false);
  });

  it('reads a rejected request as a plain failure', async () => {
    const result = await runInit(fakeApi(new Error('project slug already in use')));

    expect(result.code).toBe(EXIT_FAILED);
    expect(result.stderr).toContain('the Mneia API could not attach this repo');
    expect(result.stderr).toContain('project slug already in use');
    expect(await exists('.mneia/config.json')).toBe(false);
  });

  it('gives network, auth, and generic failures three different exit codes and messages', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const network = await runInit(fakeApi(new TypeError('fetch failed', { cause })));
    const auth = await runInit(fakeApi(), [], envWithoutCredentials());
    const failed = await runInit(fakeApi(new Error('quota exceeded')));

    const codes = [network.code, auth.code, failed.code];
    const messages = [network.stderr, auth.stderr, failed.stderr];

    expect(new Set(codes).size).toBe(3);
    expect(new Set(messages).size).toBe(3);
    expect(codes).toEqual([EXIT_NETWORK, EXIT_AUTH, EXIT_FAILED]);
  });

  it('refuses to touch a repo whose generated section is damaged', async () => {
    const damaged = `# Our repo\n\n${FENCE_BEGIN}\nhalf a section, no end marker\n`;
    await write('AGENTS.md', damaged);

    const api = fakeApi();
    const result = await runInit(api, ['--project', 'checkout']);

    expect(result.code).toBe(EXIT_FAILED);
    expect(result.stderr).toContain('damaged Mneia generated section');
    expect(api.requests).toHaveLength(0);
    expect(await exists('.mneia/config.json')).toBe(false);
    expect(await readFile(join(root, 'AGENTS.md'), 'utf8')).toBe(damaged);
  });

  it('refuses to silently rebind a repo that is already bound elsewhere', async () => {
    await runInit(fakeApi(), ['--workspace', 'acme', '--project', 'checkout']);

    const api = fakeApi();
    const result = await runInit(api, ['--project', 'payments']);

    expect(result.code).toBe(EXIT_FAILED);
    expect(result.stderr).toContain('already binds this repo to acme/checkout');
    expect(result.stderr).toContain('mneia init --force');
    expect(api.requests).toHaveLength(0);
  });

  it('rebinds when --force is given', async () => {
    await runInit(fakeApi(), ['--workspace', 'acme', '--project', 'checkout']);

    const result = await runInit(fakeApi(), ['--project', 'payments', '--force']);
    const config = await loadProjectConfig(root, {});

    expect(result.code).toBe(EXIT_OK);
    expect(config?.project).toBe('payments');
  });

  it('does not rebind on --force alone', async () => {
    await runInit(fakeApi(), ['--workspace', 'acme', '--project', 'checkout']);
    await runInit(fakeApi(), ['--force']);

    await expect(loadProjectConfig(root, {})).resolves.toMatchObject({
      workspace: 'acme',
      project: 'checkout',
    });
  });

  it('rejects positional arguments and bad flag values with usage errors', async () => {
    const positional = await runInit(fakeApi(), ['acme/checkout']);
    const slug = await runInit(fakeApi(), ['--project', 'Not A Slug']);
    const endpoint = await runInit(fakeApi(), ['--endpoint', 'not-a-url']);

    expect(positional.code).toBe(EXIT_USAGE);
    expect(positional.stderr).toContain('takes no positional arguments');
    expect(slug.code).toBe(EXIT_USAGE);
    expect(slug.stderr).toContain('pass --project not-a-slug');
    expect(endpoint.code).toBe(EXIT_USAGE);
    expect(endpoint.stderr).toContain('--endpoint expects an absolute URL');
  });
});

describe('mneia init output', () => {
  it('prints a structured payload under --json', async () => {
    await write('AGENTS.md', '- Never commit secrets\n');

    const result = await runInit(fakeApi(), [
      '--workspace',
      'acme',
      '--project',
      'checkout',
      '--json',
    ]);
    const payload: unknown = JSON.parse(result.stdout);

    expect(payload).toMatchObject({
      ok: true,
      command: 'init',
      workspace: 'acme',
      project: 'checkout',
      endpoint: 'https://app.mneia.dev',
      created: true,
      constraintsImported: 1,
      sources: ['AGENTS.md'],
      agentsFile: { result: 'updated' },
    });
  });

  it('reports a network failure as structured JSON too', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const result = await runInit(fakeApi(new TypeError('fetch failed', { cause })), ['--json']);
    const payload: unknown = JSON.parse(result.stderr);

    expect(payload).toMatchObject({ ok: false, error: { kind: 'network' } });
  });

  it('persists --endpoint but not the default one', async () => {
    await runInit(fakeApi(), ['--project', 'checkout']);
    const withDefault: unknown = JSON.parse(
      await readFile(join(root, '.mneia', 'config.json'), 'utf8'),
    );

    expect(withDefault).toEqual({ workspace: 'acme', project: 'checkout' });

    await runInit(fakeApi(), ['--endpoint', 'https://staging.mneia.dev']);
    const withOverride: unknown = JSON.parse(
      await readFile(join(root, '.mneia', 'config.json'), 'utf8'),
    );

    expect(withOverride).toEqual({
      workspace: 'acme',
      project: 'checkout',
      endpoint: 'https://staging.mneia.dev',
    });
    await expect(loadProjectConfig(root, {})).resolves.toMatchObject({
      endpoint: 'https://staging.mneia.dev',
    });

    await runInit(fakeApi(), []);
    const preserved: unknown = JSON.parse(
      await readFile(join(root, '.mneia', 'config.json'), 'utf8'),
    );

    expect(preserved).toMatchObject({ endpoint: 'https://staging.mneia.dev' });
  });
});
