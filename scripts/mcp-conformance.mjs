#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const USAGE = `usage: node scripts/mcp-conformance.mjs [options]

  --local            drive the workspace build at packages/mcp-server/dist/bin.js (default)
  --published        drive npx -y @mneia/mcp-server@<version> from the registry
  --version <spec>   registry version for --published (default: latest)
  --as <profile>     replay a client's initialize handshake (default: baseline)
  --protocol <ver>   override the profile's protocolVersion
  --timeout <ms>     per-request timeout (default: 45000)
  --json             emit the report as JSON on stdout and nothing else
  --record <file>    run as a shim server instead: record the launching client's
                     initialize request to <file>, answer it, and exit
  --url <endpoint>   drive a remote Streamable HTTP endpoint instead of a local
                     binary, e.g. http://localhost:3000/api/mcp
  --token <token>    bearer token for --url (default: MNEIA_TOKEN)

Drives the Mneia MCP server over real stdio JSON-RPC the way a client does, and
reports what a client would see: the negotiated protocol version, the declared
capabilities, the tool names actually discoverable, and the error a client gets
for the methods we do not implement.

This exists because the matrix in docs/CLIENTS.md was driven by hand and went
three releases stale. Run it instead of retyping a JSON-RPC session.

Needs the same auth the server always needs: MNEIA_TOKEN, or a ~/.mneia/credentials
written by mneia login, or ~/.mneia/local.json. Without one the server exits at
startup and this reports that as a start failure, which is what a client shows.

--record inverts the direction. Point a real client's MCP config at
  node scripts/mcp-conformance.mjs --record docs/handshakes/cursor.jsonl
and the client's own initialize request is written there verbatim. That is how a
client profile gets captured rather than guessed.`;

// Every non-baseline profile is a verbatim replay of a handshake recorded from a real
// client with --record, not a reconstruction. Hand-written profiles are how the previous
// matrix came to claim Claude Code speaks 2025-06-18: that was the version the prober
// happened to ask for, recorded as though the client had chosen it.
const PROFILES = {
  baseline: {
    capturedFrom: null,
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'mneia-conformance', version: '1' },
    capabilities: {},
  },
  'claude-code': {
    capturedFrom: 'Claude Code 2.1.239, docs/handshakes/claude-code.jsonl',
    protocolVersion: '2025-11-25',
    clientInfo: {
      name: 'claude-code',
      title: 'Claude Code',
      version: '2.1.239',
      description: "Anthropic's agentic coding tool",
      websiteUrl: 'https://claude.com/claude-code',
    },
    capabilities: { roots: { listChanged: true }, elicitation: {} },
  },
  codex: {
    capturedFrom: 'Codex CLI 0.149.0, docs/handshakes/codex.jsonl',
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'codex-mcp-client', title: 'Codex', version: '0.149.0' },
    capabilities: { elicitation: { form: {}, url: {} } },
  },
  legacy: {
    capturedFrom: null,
    protocolVersion: '2024-11-05',
    clientInfo: { name: 'mneia-conformance-legacy', version: '1' },
    capabilities: {},
  },
};

const parseArgs = (argv) => {
  const options = {
    source: 'local',
    version: 'latest',
    profile: 'baseline',
    protocol: null,
    timeout: 45000,
    json: false,
    record: null,
    url: null,
    token: process.env.MNEIA_TOKEN ?? null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--local') options.source = 'local';
    else if (arg === '--published') options.source = 'published';
    else if (arg === '--version') options.version = value();
    else if (arg === '--as') options.profile = value();
    else if (arg === '--protocol') options.protocol = value();
    else if (arg === '--timeout') options.timeout = Number.parseInt(value(), 10);
    else if (arg === '--json') options.json = true;
    else if (arg === '--record') options.record = value();
    else if (arg === '--url') options.url = value();
    else if (arg === '--token') options.token = value();
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${USAGE}\n`);
      process.exit(0);
    } else throw new Error(`unrecognised option ${arg}\n\n${USAGE}`);
  }
  if (options.record === null && PROFILES[options.profile] === undefined) {
    throw new Error(
      `--as expects one of ${Object.keys(PROFILES).join(', ')}; got "${options.profile}". Capture a new one with --record rather than adding a guess.`,
    );
  }
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new Error('--timeout expects a positive number of milliseconds');
  }
  return options;
};

const VERSION_SPEC = /^[A-Za-z0-9][A-Za-z0-9._+-]*$|^[\^~][0-9][A-Za-z0-9._+-]*$/;

// Shim mode. We stand in for the real server so a client's own initialize frame can be
// captured, which is the only way to learn what a client sends without guessing. The
// replies are the bare minimum needed to keep the client talking long enough to reach
// tools/list; this is a recorder, not a server. It works even when the client cannot
// reach its model, which is how the Codex profile was captured through a usage limit.
const recordHandshake = async (target) => {
  await mkdir(dirname(target), { recursive: true });
  let buffer = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      await appendFile(target, `${JSON.stringify(message)}\n`, 'utf8');
      if (message.method === 'initialize') {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'mneia-conformance-shim', version: '1' },
            },
          })}\n`,
        );
      }
      if (message.method === 'tools/list') {
        process.stdout.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [] } })}\n`,
        );
      }
    }
  }
};

const startServer = (options) => {
  if (options.source === 'local') {
    const args = [join('packages', 'mcp-server', 'dist', 'bin.js')];
    const child = spawn(process.execPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    return { child, described: `node ${args[0]}` };
  }
  // npx resolves to a .cmd shim on Windows, which Node refuses to spawn directly since the
  // CVE-2024-27980 fix. Passing the whole command as one string under a shell is the form
  // that works on both platforms; args are not interpolated from user input beyond
  // options.version, which VERSION_SPEC has already constrained.
  const described = `npx -y @mneia/mcp-server@${options.version}`;
  const child = spawn(described, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
    shell: true,
  });
  return { child, described };
};

// MCP over stdio frames each JSON-RPC message as one line of JSON. We buffer because a
// single stdout chunk may split a message or carry several, and correlate replies to
// requests by id — notifications carry no id and are ignored here.
const createSession = (child, timeout) => {
  const pending = new Map();
  let buffer = '';
  let stderr = '';
  let exited = null;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id !== undefined && pending.has(message.id)) {
        const settle = pending.get(message.id);
        pending.delete(message.id);
        settle.resolve(message);
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  // The server exits rather than erroring when it has no store to talk to, so an
  // unanswered request usually means a startup failure. Surface its stderr with the
  // rejection or the caller is left with a bare timeout and nothing to act on.
  child.on('close', (code) => {
    exited = code;
    for (const settle of pending.values()) {
      settle.reject(
        new Error(
          `server exited with code ${code} before answering${stderr.trim().length > 0 ? `\n${stderr.trim()}` : ''}`,
        ),
      );
    }
    pending.clear();
  });

  let nextId = 1;
  const request = (method, params) => {
    const id = nextId;
    nextId += 1;
    const started = performance.now();
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} did not answer within ${timeout}ms`));
        }
      }, timeout);
      timer.unref?.();
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return promise.then((message) => ({ message, ms: performance.now() - started }));
  };
  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  return { request, notify, stderrText: () => stderr, exitCode: () => exited };
};

// Streamable HTTP speaks the same JSON-RPC, so this exposes the identical {request, notify}
// shape the stdio session does and main() does not care which it got. Notifications are POSTed
// and their 202 discarded, which is what the spec prescribes for a request with no id.
const createHttpSession = (endpoint, token, timeout) => {
  let nextId = 1;
  let stderr = '';

  const post = async (body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      return await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Both are required by the spec even when the server answers with plain JSON: a server
          // is free to upgrade any response to a stream, so a client must declare it can read one.
          accept: 'application/json, text/event-stream',
          ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const request = async (method, params) => {
    const id = nextId;
    nextId += 1;
    const started = performance.now();
    const response = await post({ jsonrpc: '2.0', id, method, params });
    const text = await response.text();

    if (!response.ok) {
      // A 401 carries WWW-Authenticate, which is the whole point of RFC 9728 discovery — surface
      // it rather than reporting a bare status a reader cannot act on.
      const auth = response.headers.get('www-authenticate');
      if (auth !== null) stderr += `${auth}\n`;
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 400)}`);
    }

    // With enableJsonResponse the body is a JSON-RPC message. Without it the server may answer
    // with an SSE stream, whose data: frames carry the same messages.
    const payload = text.startsWith('data:')
      ? JSON.parse(
          text
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join(''),
        )
      : JSON.parse(text);

    return { message: payload, ms: performance.now() - started };
  };

  const notify = (method, params) => {
    void post({ jsonrpc: '2.0', method, params }).catch(() => undefined);
  };

  return { request, notify, stderrText: () => stderr, exitCode: () => null };
};

const attempt = async (label, run) => {
  try {
    const outcome = await run();
    return { step: label, ok: true, ...outcome };
  } catch (error) {
    return {
      step: label,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));

  if (options.record !== null) {
    await recordHandshake(options.record);
    return;
  }

  if (options.source === 'published' && !VERSION_SPEC.test(options.version)) {
    throw new Error(
      `--version expects a dist-tag or a single semver like latest, 0.12.0 or ^0.12.0; got "${options.version}". It is interpolated into an npx invocation, so anything outside that shape is refused rather than passed through.`,
    );
  }

  const profile = PROFILES[options.profile];
  const requested = options.protocol ?? profile.protocolVersion;

  const remote = options.url !== null;
  const { child, described } = remote
    ? { child: null, described: options.url }
    : startServer(options);
  const session = remote
    ? createHttpSession(options.url, options.token, options.timeout)
    : createSession(child, options.timeout);
  const report = {
    target: described,
    source: options.source,
    profile: options.profile,
    requestedProtocol: requested,
    startedAt: new Date().toISOString(),
    steps: [],
  };

  const initialize = await attempt('initialize', async () => {
    const { message, ms } = await session.request('initialize', {
      protocolVersion: requested,
      capabilities: profile.capabilities,
      clientInfo: profile.clientInfo,
    });
    if (message.error !== undefined) throw new Error(JSON.stringify(message.error));
    return { ms, result: message.result };
  });
  report.steps.push(initialize);

  if (initialize.ok) {
    report.negotiatedProtocol = initialize.result?.protocolVersion ?? null;
    report.serverInfo = initialize.result?.serverInfo ?? null;
    report.capabilities = initialize.result?.capabilities ?? null;
    report.instructions =
      typeof initialize.result?.instructions === 'string'
        ? `${initialize.result.instructions.length} chars`
        : 'absent';

    session.notify('notifications/initialized', {});

    const tools = await attempt('tools/list', async () => {
      const { message, ms } = await session.request('tools/list', {});
      if (message.error !== undefined) throw new Error(JSON.stringify(message.error));
      return { ms, result: message.result };
    });
    report.steps.push(tools);
    if (tools.ok) {
      const list = tools.result?.tools ?? [];
      report.toolCount = list.length;
      report.toolNames = list.map((tool) => tool.name).sort();
      report.toolsMissingDescription = list
        .filter((tool) => typeof tool.description !== 'string' || tool.description.length === 0)
        .map((tool) => tool.name);
      report.toolsDeclaringOutputSchema = list
        .filter((tool) => tool.outputSchema !== undefined)
        .map((tool) => tool.name);
    }

    for (const method of ['resources/list', 'prompts/list']) {
      const unimplemented = await attempt(method, async () => {
        const { message, ms } = await session.request(method, {});
        return {
          ms,
          errorCode: message.error?.code ?? null,
          errorMessage: message.error?.message ?? null,
          answered: message.error === undefined,
        };
      });
      report.steps.push(unimplemented);
    }

    const call = await attempt('tools/call mneia_sessions', async () => {
      const { message, ms } = await session.request('tools/call', {
        name: 'mneia_sessions',
        arguments: { project: 'mneia', limit: 1 },
      });
      if (message.error !== undefined) throw new Error(JSON.stringify(message.error));
      const content = message.result?.content ?? [];
      return {
        ms,
        isError: message.result?.isError === true,
        contentBlocks: content.length,
        contentTypes: [...new Set(content.map((block) => block.type))],
        textLength: content
          .filter((block) => block.type === 'text')
          .reduce((sum, block) => sum + block.text.length, 0),
        structuredContent: message.result?.structuredContent !== undefined,
      };
    });
    report.steps.push(call);
  }

  if (child !== null) {
    child.stdin.end();
    child.kill();
  }

  const stderrText = session.stderrText().trim();
  if (stderrText.length > 0) report.stderr = stderrText;
  report.ok = report.steps.every((step) => step.ok);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  process.stdout.write(`${described}\n`);
  process.stdout.write(`  as              ${options.profile} (requested ${requested})\n`);
  if (initialize.ok) {
    process.stdout.write(`  negotiated      ${report.negotiatedProtocol}\n`);
    process.stdout.write(
      `  serverInfo      ${report.serverInfo?.name} ${report.serverInfo?.version}\n`,
    );
    process.stdout.write(
      `  capabilities    ${Object.keys(report.capabilities ?? {}).join(', ')}\n`,
    );
    process.stdout.write(`  instructions    ${report.instructions}\n`);
  }
  process.stdout.write('\n');
  for (const step of report.steps) {
    const timing = step.ms === undefined ? '' : ` ${step.ms.toFixed(0)}ms`;
    process.stdout.write(`  ${step.ok ? 'ok  ' : 'FAIL'} ${step.step}${timing}\n`);
    if (!step.ok) process.stdout.write(`       ${step.error}\n`);
    if (step.errorCode !== undefined && step.errorCode !== null) {
      process.stdout.write(`       ${step.errorCode} ${step.errorMessage}\n`);
    }
    if (step.answered === true) {
      process.stdout.write('       answered rather than refused — capability is undeclared\n');
    }
  }
  if (report.toolNames !== undefined) {
    process.stdout.write(`\n  ${report.toolCount} tools\n`);
    for (const name of report.toolNames) process.stdout.write(`    ${name}\n`);
    if (report.toolsMissingDescription?.length > 0) {
      process.stdout.write(`  no description: ${report.toolsMissingDescription.join(', ')}\n`);
    }
    process.stdout.write(
      `  outputSchema declared by ${report.toolsDeclaringOutputSchema?.length ?? 0} of ${report.toolCount}\n`,
    );
  }
  if (stderrText.length > 0) {
    process.stdout.write(`\n  stderr\n${stderrText.replace(/^/gm, '    ')}\n`);
  }
  process.exitCode = report.ok ? 0 : 1;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
