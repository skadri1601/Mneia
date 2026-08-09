#!/usr/bin/env node

const NOT_JSON = 2;
const ABSENT = 3;
const MISUSE = 4;

const path = process.argv[2];

if (path === undefined || path.length === 0) {
  process.stderr.write(
    'expected a dotted field path such as schemaVersion.applied; found none — usage: read-health-field.mjs <path> < health.json\n',
  );
  process.exit(MISUSE);
}

const read = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const raw = await read();

let report;
try {
  report = JSON.parse(raw);
} catch {
  const preview = raw.trim().slice(0, 200);
  process.stderr.write(
    `expected the health endpoint to return JSON; found ${preview.length === 0 ? 'an empty body' : preview}\n`,
  );
  process.exit(NOT_JSON);
}

let value = report;
for (const segment of path.split('.')) {
  if (typeof value !== 'object' || value === null || !(segment in value)) {
    process.stderr.write(`the health report has no ${path}\n`);
    process.exit(ABSENT);
  }
  value = value[segment];
}

if (value === null || value === undefined) {
  process.stderr.write(`the health report reports ${path} as null\n`);
  process.exit(ABSENT);
}

process.stdout.write(String(value));
