#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USAGE = `usage: node scripts/verify-client-journey.mjs [options]

  --published        run npx @mneia/cli@<version> from the registry (default)
  --local            run the workspace build at packages/cli/dist/bin.js
  --version <spec>   registry version for --published (default: latest)
  --endpoint <url>   API endpoint (default: https://app.mneia.dev)
  --project <slug>   project slug to bind (default: mneia-verify)
  --in <dir>         run the journey here instead of a fresh temp repo
  --home <dir>       credentials directory (default: <tmp>/mneia-verify-home)
  --fresh            delete the credentials directory first, forcing a new login
  --keep             leave the temp repo in place for inspection

Proves the journey a customer walks on a machine with no Mneia configuration. It never reads or
writes the real ~/.mneia: MNEIA_HOME points at a directory of its own for the whole run.

Needs a token. Either export MNEIA_TOKEN, or run the login step it prints and re-run — the
credentials directory is stable across runs, so the login survives.`;

const parseArgs = (argv) => {
  const options = {
    source: 'published',
    version: 'latest',
    endpoint: 'https://app.mneia.dev',
    project: null,
    in: null,
    home: null,
    fresh: false,
    keep: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    if (arg === '--published') options.source = 'published';
    else if (arg === '--local') options.source = 'local';
    else if (arg === '--version') options.version = value();
    else if (arg === '--endpoint') options.endpoint = value();
    else if (arg === '--project') options.project = value();
    else if (arg === '--in') options.in = value();
    else if (arg === '--home') options.home = value();
    else if (arg === '--fresh') options.fresh = true;
    else if (arg === '--keep') options.keep = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else throw new Error(`unrecognised option ${arg}\n\n${USAGE}`);
  }
  return options;
};

const run = (command, args, cwd, env) =>
  new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({
        code: -1,
        stdout,
        stderr: `${stderr}${error.message}`,
        ms: performance.now() - started,
      });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr, ms: performance.now() - started });
    });
  });

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  const home = options.home ?? join(tmpdir(), 'mneia-verify-home');
  if (options.fresh) await rm(home, { recursive: true, force: true });
  await mkdir(home, { recursive: true });

  const repo = options.in ?? (await mkdtemp(join(tmpdir(), 'mneia-verify-repo-')));

  const env = {
    MNEIA_HOME: home,
    MNEIA_API_URL: options.endpoint,
    MNEIA_AUTH_URL: options.endpoint,
  };

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const invoke =
    options.source === 'local'
      ? (args) =>
          run(
            process.execPath,
            [join(process.cwd(), 'packages/cli/dist/bin.js'), ...args],
            repo,
            env,
          )
      : (args) => run(npx, ['-y', `@mneia/cli@${options.version}`, ...args], repo, env);

  const label =
    options.source === 'local'
      ? 'packages/cli/dist/bin.js (workspace build)'
      : `@mneia/cli@${options.version} from the registry`;

  process.stdout.write(`Verifying ${label}\n`);
  process.stdout.write(`  endpoint  ${options.endpoint}\n`);
  process.stdout.write(`  home      ${home}\n`);
  process.stdout.write(`  repo      ${repo}\n\n`);

  if (options.in === null) {
    await mkdir(join(repo, '.git'), { recursive: true });
    await writeFile(
      join(repo, 'AGENTS.md'),
      '# Verification repo\n\nCreated by scripts/verify-client-journey.mjs.\n',
      'utf8',
    );
  }

  const credentials = await readFile(join(home, 'credentials'), 'utf8').catch(() => '');
  const authenticated =
    (process.env.MNEIA_TOKEN ?? '').trim().length > 0 || credentials.trim().length > 0;

  if (!authenticated) {
    process.stdout.write(
      [
        'No MNEIA_TOKEN in the environment, so the device flow has to run first.',
        '',
        'Run this, approve in the browser, then re-run this script:',
        '',
        `  MNEIA_HOME=${home} MNEIA_AUTH_URL=${options.endpoint} \\`,
        options.source === 'local'
          ? `    node ${join(process.cwd(), 'packages/cli/dist/bin.js')} login`
          : `    npx -y @mneia/cli@${options.version} login`,
        '',
        `That writes the credential to ${join(home, 'credentials')} and touches nothing else.`,
        'Or export MNEIA_TOKEN from a token you already hold.',
        '',
      ].join('\n'),
    );
    if (options.in === null) await rm(repo, { recursive: true, force: true });
    process.exitCode = 2;
    return;
  }

  const project = options.project ?? 'mneia-verify';

  const steps = [
    { name: 'whoami', args: ['whoami'], required: true },
    {
      name: 'init',
      args: ['init', '--project', project, '--endpoint', options.endpoint],
      required: true,
    },
    { name: 'status', args: ['status'], required: true },
    { name: 'brief', args: ['brief', 'next customer task'], required: true },
    { name: 'checkpoint', args: ['checkpoint', '--json'], required: false },
  ];

  const results = [];
  let failed = false;

  for (const step of steps) {
    const result = await invoke(step.args);
    results.push({ ...step, ...result });
    const ok = result.code === 0;
    process.stdout.write(
      `${ok ? 'ok  ' : 'FAIL'}  ${step.name.padEnd(11)} ${seconds(result.ms).padStart(7)}  exit ${result.code}\n`,
    );
    if (!ok) {
      const detail = (result.stderr || result.stdout).trim().split('\n').slice(0, 6);
      for (const line of detail) process.stdout.write(`        ${line}\n`);
      if (step.required) {
        failed = true;
        break;
      }
    }
  }

  const total = results.reduce((sum, result) => sum + result.ms, 0);
  process.stdout.write(`\n  total ${seconds(total)} across ${results.length} commands\n`);

  const configPath = join(repo, '.mneia', 'config.json');
  const config = await readFile(configPath, 'utf8').catch(() => null);
  if (config === null) {
    process.stdout.write(
      `\nFAIL  ${configPath} was never written, so init did not bind anything\n`,
    );
    failed = true;
  } else {
    process.stdout.write(`\n  ${configPath}\n${config.trim().replace(/^/gm, '    ')}\n`);
  }

  const checkpoint = results.find((result) => result.name === 'checkpoint');
  if (checkpoint !== undefined && checkpoint.code !== 0) {
    process.stdout.write(
      [
        '',
        'checkpoint is advisory here and did not pass.',
        'It discovers an agent session for the working directory, and a freshly created',
        'temp repo has none. Re-run with --in <a repo you have an open session in> to',
        'exercise it, and note that a non-zero exit with candidates pending review is the',
        'documented behaviour without a TTY, not a defect.',
        '',
      ].join('\n'),
    );
  }

  if (options.keep || options.in !== null) {
    process.stdout.write(`\n  kept ${repo}\n`);
  } else {
    await rm(repo, { recursive: true, force: true });
  }
  process.stdout.write(`  credentials remain in ${home} — --fresh clears them\n`);

  process.exitCode = failed ? 1 : 0;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
