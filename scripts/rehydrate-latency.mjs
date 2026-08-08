#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { request } from 'node:https';
import { fileURLToPath } from 'node:url';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(fileURLToPath(envFile));
}

const args = process.argv.slice(2);
const flagValue = (flag, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${flag}=`));
  return found === undefined ? fallback : found.slice(flag.length + 3);
};

const origin = flagValue('origin', process.env.MNEIA_API_ORIGIN ?? 'https://app.mneia.dev');
const runs = Number(flagValue('runs', '20'));
const project = flagValue('project', process.env.MNEIA_PROJECT ?? '');
const tokenBudget = Number(flagValue('token-budget', '4000'));
const task = flagValue('task', 'Continue the rehydration latency work');
const token = process.env.MNEIA_TOKEN ?? '';
const asJson = args.includes('--json');

const P95_BUDGET_MS = 300;
const MEASURED_IN_PROCESS_P95_MS = 166;

if (!Number.isInteger(runs) || runs < 1) {
  process.stderr.write(`rehydrate-latency: --runs must be a positive integer; received ${runs}\n`);
  process.exit(1);
}

let url;
try {
  url = new URL(origin);
} catch {
  process.stderr.write(`rehydrate-latency: --origin must be an absolute URL; received ${origin}\n`);
  process.exit(1);
}

if (url.protocol !== 'https:') {
  process.stderr.write(
    `rehydrate-latency: --origin must be https so the TLS handshake is measured; received ${url.protocol}\n`,
  );
  process.exit(1);
}

const percentile = (sorted, fraction) => {
  if (sorted.length === 0) {
    return null;
  }
  const rank = Math.ceil(sorted.length * fraction) - 1;
  return sorted[Math.min(Math.max(rank, 0), sorted.length - 1)];
};

const summarize = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    samples: sorted.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? null,
  };
};

function timedRequest({ path, method, body, headers, agentless }) {
  return new Promise((resolve, reject) => {
    const marks = { start: performance.now() };

    const req = request(
      {
        hostname: url.hostname,
        port: url.port === '' ? 443 : Number(url.port),
        path,
        method,
        headers,
        agent: agentless ? false : undefined,
      },
      (res) => {
        res.once('readable', () => {
          marks.firstByte = performance.now();
        });
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          marks.end = performance.now();
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            timings: {
              dnsMs: marks.lookup === undefined ? null : marks.lookup - marks.start,
              connectMs:
                marks.connect === undefined || marks.lookup === undefined
                  ? null
                  : marks.connect - marks.lookup,
              tlsMs:
                marks.secure === undefined || marks.connect === undefined
                  ? null
                  : marks.secure - marks.connect,
              serverMs:
                marks.firstByte === undefined || marks.sent === undefined
                  ? null
                  : marks.firstByte - marks.sent,
              totalMs: marks.end - marks.start,
            },
          });
        });
      },
    );

    req.on('socket', (socket) => {
      if (socket.connecting !== true) {
        return;
      }
      socket.once('lookup', () => {
        marks.lookup = performance.now();
      });
      socket.once('connect', () => {
        marks.connect = performance.now();
      });
      socket.once('secureConnect', () => {
        marks.secure = performance.now();
      });
    });

    req.on('error', reject);
    req.on('finish', () => {
      marks.sent = performance.now();
    });

    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

async function measureColdConnection() {
  const totals = [];
  const handshakes = [];

  for (let run = 0; run < runs; run += 1) {
    const result = await timedRequest({
      path: '/api/health',
      method: 'GET',
      headers: { accept: 'application/json' },
      agentless: true,
    });
    totals.push(result.timings.totalMs);
    const dns = result.timings.dnsMs ?? 0;
    const connect = result.timings.connectMs ?? 0;
    const tls = result.timings.tlsMs ?? 0;
    handshakes.push(dns + connect + tls);
  }

  return { total: summarize(totals), handshake: summarize(handshakes) };
}

async function measureWarmConnection() {
  const totals = [];
  for (let run = 0; run < runs; run += 1) {
    const result = await timedRequest({
      path: '/api/health',
      method: 'GET',
      headers: { accept: 'application/json', connection: 'keep-alive' },
      agentless: false,
    });
    totals.push(result.timings.totalMs);
  }
  return summarize(totals);
}

async function measureRehydrate() {
  if (token === '' || project === '') {
    return null;
  }

  const payload = JSON.stringify({ project, task, tokenBudget });
  const totals = [];
  const serverTimes = [];
  let status = 0;

  for (let run = 0; run < runs; run += 1) {
    const result = await timedRequest({
      path: '/api/v1/rehydrate',
      method: 'POST',
      body: payload,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      agentless: false,
    });
    status = result.status;
    if (result.status !== 200) {
      return { status, body: result.body.slice(0, 400), total: null, serverMs: null };
    }
    totals.push(result.timings.totalMs);
    if (result.timings.serverMs !== null) {
      serverTimes.push(result.timings.serverMs);
    }
  }

  return { status, total: summarize(totals), serverMs: summarize(serverTimes) };
}

const ms = (value) => (value === null || value === undefined ? 'n/a' : `${value.toFixed(1)}ms`);

function render(report) {
  const lines = [];
  const w = (line = '') => lines.push(line);

  w(`Rehydrate latency against ${report.origin} — ${report.runs} runs per measurement`);
  w();
  w('Network floor, new TLS connection each time (worst case: first call of a session)');
  w(`  handshake  p50 ${ms(report.cold.handshake.p50)}   p95 ${ms(report.cold.handshake.p95)}`);
  w(`  round trip p50 ${ms(report.cold.total.p50)}   p95 ${ms(report.cold.total.p95)}`);
  w();
  w('Network floor, reused connection (the common case once a session is running)');
  w(`  round trip p50 ${ms(report.warm.p50)}   p95 ${ms(report.warm.p95)}`);
  w();

  if (report.rehydrate === null) {
    w('Real rehydrate: not measured.');
    w('  Set MNEIA_TOKEN and pass --project=<slug> to measure /api/v1/rehydrate itself.');
  } else if (report.rehydrate.total === null) {
    w(`Real rehydrate: refused with HTTP ${report.rehydrate.status}.`);
    w(`  ${report.rehydrate.body}`);
  } else {
    w('Real rehydrate, POST /api/v1/rehydrate');
    w(`  round trip p50 ${ms(report.rehydrate.total.p50)}   p95 ${ms(report.rehydrate.total.p95)}`);
    w(
      `  server time p50 ${ms(report.rehydrate.serverMs.p50)}   p95 ${ms(report.rehydrate.serverMs.p95)}`,
    );
  }

  w();
  w('Against the §12.1 budget');
  w(`  budget                        ${P95_BUDGET_MS}ms p95`);
  w(`  store and ranking, measured   ${MEASURED_IN_PROCESS_P95_MS}ms p95 (MNE-73, no network)`);
  const headroom = P95_BUDGET_MS - MEASURED_IN_PROCESS_P95_MS;
  w(`  leaves for the network        ${headroom}ms p95`);
  const warmP95 = report.warm.p95 ?? 0;
  const coldP95 = report.cold.total.p95 ?? 0;
  w(
    warmP95 <= headroom
      ? `  A reused connection at ${ms(warmP95)} fits inside that. The budget is reachable warm.`
      : `  A reused connection at ${ms(warmP95)} already exceeds ${headroom}ms. The budget is not reachable as written.`,
  );
  w(
    coldP95 <= headroom
      ? `  A cold connection at ${ms(coldP95)} also fits, so even the first call of a session holds.`
      : `  A cold connection at ${ms(coldP95)} does not fit, so the first call of a session misses the budget. Keep the connection alive across calls, or measure the budget from the second call on and say so.`,
  );

  return lines.join('\n');
}

try {
  const cold = await measureColdConnection();
  const warm = await measureWarmConnection();
  const rehydrate = await measureRehydrate();
  const report = { origin, runs, cold, warm, rehydrate };

  process.stdout.write(asJson ? `${JSON.stringify(report, null, 2)}\n` : `${render(report)}\n`);
} catch (error) {
  process.stderr.write(
    `rehydrate-latency: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
