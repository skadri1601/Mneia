#!/usr/bin/env node

const NOT_JSON = 2;
const ABSENT = 3;

const read = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const raw = await read();

let response;
try {
  response = JSON.parse(raw);
} catch {
  process.stderr.write(
    `expected the Neon connection_uri endpoint to return JSON; found ${raw.trim().length === 0 ? 'an empty body' : 'something that is not JSON'}\n`,
  );
  process.exit(NOT_JSON);
}

const uri = response?.uri;

if (typeof uri !== 'string' || !uri.startsWith('postgres')) {
  process.stderr.write(
    'expected a "uri" holding a Postgres connection string; the Neon response carried none. Nothing is printed, because printing whatever came back would leak it into the run log.\n',
  );
  process.exit(ABSENT);
}

if (uri.includes('-pooler.')) {
  process.stderr.write(
    'expected the direct Neon endpoint; got the pooled one. The migration runner holds a session-level pg_advisory_lock across the whole run, and PgBouncer in transaction mode can change the server connection between statements. Request the URI with pooled=false.\n',
  );
  process.exit(ABSENT);
}

process.stdout.write(uri);
