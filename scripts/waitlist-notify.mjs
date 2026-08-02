#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  campaignNames,
  findCampaign,
  missingVariables,
  renderCampaign,
} from './waitlist-campaigns.mjs';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const PREVIEW_TOKEN = '00000000-0000-4000-8000-000000000000';
const DEFAULT_PACE_MS = 550;
const MAX_ATTEMPTS = 4;

export const SENT = 'sent';
export const REJECTED = 'rejected';
export const UNKNOWN = 'unknown';

export class UsageError extends Error {}

const NUMERIC = new Set(['--limit', '--pace']);

function readOption(options, arg, raw) {
  if (NUMERIC.has(arg)) {
    const value = Number(raw);
    const floor = arg === '--limit' ? 1 : 0;

    if (!Number.isInteger(value) || value < floor) {
      throw new UsageError(
        `expected ${arg} to be followed by a whole number of at least ${floor}; received ${raw ?? 'nothing'}`,
      );
    }

    if (arg === '--limit') options.limit = value;
    else options.pace = value;
    return;
  }

  const split = typeof raw === 'string' ? raw.indexOf('=') : -1;

  if (split < 1) {
    throw new UsageError(
      `expected --var to be followed by key=value; received ${raw ?? 'nothing'}`,
    );
  }

  options.vars[raw.slice(0, split)] = raw.slice(split + 1);
}

export function parseArgs(argv) {
  const options = {
    campaign: undefined,
    send: false,
    limit: undefined,
    pace: DEFAULT_PACE_MS,
    vars: {},
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--send') options.send = true;
    else if (NUMERIC.has(arg) || arg === '--var') {
      readOption(options, arg, argv[index + 1]);
      index += 1;
    } else if (arg.startsWith('-')) {
      throw new UsageError(`unrecognised option ${arg} — run with --help for the accepted ones`);
    } else if (options.campaign === undefined) {
      options.campaign = arg;
    } else {
      throw new UsageError(
        `expected one campaign name; received both ${options.campaign} and ${arg}`,
      );
    }
  }

  return options;
}

export const usage = () =>
  [
    'Usage: pnpm waitlist:notify <campaign> [--send] [--var key=value] [--limit N] [--pace MS]',
    '',
    `Campaigns: ${campaignNames().join(', ')}`,
    '',
    'Without --send this prints the recipient count and a rendered preview, and sends nothing.',
    'Every delivery is recorded, so re-running a campaign only reaches subscribers it missed.',
    'A delivery whose outcome could not be established is recorded as unresolved and is never',
    'retried automatically — reconcile it against the Resend dashboard before releasing it.',
  ].join('\n');

const sleep = (ms) =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export const idempotencyKey = (campaignId, signupId) => `${campaignId}:${signupId}`;

export function selectRecipientsSql(limit) {
  return `
    SELECT s.id, s.email, s.unsubscribe_token
      FROM waitlist_signup s
     WHERE NOT EXISTS (
             SELECT 1
               FROM waitlist_broadcast_send b
              WHERE b.campaign = $1
                AND b.signup_id = s.id
           )
     ORDER BY s.created_at
     ${limit === undefined ? '' : `LIMIT ${Number(limit)}`}
  `;
}

async function attemptDelivery(message, apiKey, key, fetchImpl) {
  let response;

  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        'Idempotency-Key': key,
      },
      body: JSON.stringify(message),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    return {
      settled: {
        outcome: UNKNOWN,
        detail: `the request to Resend failed in transit (${cause}) — it may still have been accepted`,
      },
    };
  }

  if (response.ok) {
    const payload = await response.json().catch(() => ({}));
    return {
      settled: { outcome: SENT, providerId: typeof payload.id === 'string' ? payload.id : null },
    };
  }

  const status = response.status;
  const detail = `Resend returned ${status} ${response.statusText}`;

  if (status >= 400 && status < 500 && status !== 429) {
    return { settled: { outcome: REJECTED, detail } };
  }

  return { status, detail };
}

export async function deliver(message, apiKey, key, fetchImpl = fetch) {
  let last = { status: 0, detail: 'no attempt was made' };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const step = await attemptDelivery(message, apiKey, key, fetchImpl);

    if (step.settled !== undefined) return step.settled;

    last = step;
    if (attempt < MAX_ATTEMPTS) await sleep(DEFAULT_PACE_MS * 2 ** attempt);
  }

  const exhausted = `${last.detail} on all ${MAX_ATTEMPTS} attempts`;

  return last.status === 429
    ? { outcome: REJECTED, detail: exhausted }
    : { outcome: UNKNOWN, detail: `${exhausted} — it may still have been accepted` };
}

async function reportUnresolved(client, campaignId) {
  const { rows } = await client.query(
    `SELECT status, count(*)::int AS n
       FROM waitlist_broadcast_send
      WHERE campaign = $1 AND status <> 'sent'
      GROUP BY status`,
    [campaignId],
  );

  for (const row of rows) {
    const meaning =
      row.status === UNKNOWN
        ? 'delivery outcome never established'
        : 'claimed but interrupted before delivery';

    process.stdout.write(
      `waitlist:notify: ${row.n} row(s) held as '${row.status}' — ${meaning}.\n` +
        `  These addresses are excluded from every run until you resolve them. Inspect with:\n` +
        `  SELECT s.email, b.status, b.claimed_at FROM waitlist_broadcast_send b\n` +
        `    JOIN waitlist_signup s ON s.id = b.signup_id\n` +
        `   WHERE b.campaign = '${campaignId}' AND b.status <> 'sent';\n`,
    );
  }
}

async function sendToRecipient(client, context, row) {
  const { campaign, options, apiKey, from } = context;
  const rendered = renderCampaign(campaign, {
    unsubscribeToken: row.unsubscribe_token,
    vars: options.vars,
  });

  const claim = await client.query(
    `INSERT INTO waitlist_broadcast_send (campaign, signup_id)
     VALUES ($1, $2)
     ON CONFLICT (campaign, signup_id) DO NOTHING
     RETURNING id`,
    [campaign.id, row.id],
  );

  if (claim.rows.length === 0) {
    process.stdout.write(`  skipped ${row.email} — already recorded for this campaign\n`);
    return 'skipped';
  }

  const claimId = claim.rows[0].id;
  const result = await deliver(
    {
      from,
      to: [row.email],
      subject: rendered.subject,
      headers: rendered.headers,
      text: rendered.text,
    },
    apiKey,
    idempotencyKey(campaign.id, row.id),
  );

  if (result.outcome === REJECTED) {
    await client.query('DELETE FROM waitlist_broadcast_send WHERE id = $1', [claimId]);
    process.stderr.write(`  rejected ${row.email}: ${result.detail} — not sent, safe to retry\n`);
    return REJECTED;
  }

  if (result.outcome === UNKNOWN) {
    await client.query('UPDATE waitlist_broadcast_send SET status = $2 WHERE id = $1', [
      claimId,
      UNKNOWN,
    ]);
    process.stderr.write(
      `  unresolved ${row.email}: ${result.detail} — held, will not be retried\n`,
    );
    return UNKNOWN;
  }

  try {
    await client.query(
      `UPDATE waitlist_broadcast_send
          SET status = $3, provider_id = $2, delivered_at = now()
        WHERE id = $1`,
      [claimId, result.providerId, SENT],
    );
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `  sent ${row.email} but could not record it (${cause}) — the claim stands, so no duplicate\n`,
    );
  }

  process.stdout.write(`  sent ${row.email}\n`);
  return SENT;
}

async function sendCampaign(client, context, recipients) {
  const tally = { [SENT]: 0, [REJECTED]: 0, [UNKNOWN]: 0, skipped: 0 };

  for (const [index, row] of recipients.entries()) {
    tally[await sendToRecipient(client, context, row)] += 1;
    if (index < recipients.length - 1) await sleep(context.options.pace);
  }

  process.stdout.write(
    `waitlist:notify: ${tally[SENT]} sent, ${tally[REJECTED]} rejected, ` +
      `${tally[UNKNOWN]} unresolved, ${tally.skipped} skipped\n`,
  );

  if (tally[UNKNOWN] > 0) {
    process.stdout.write(
      'waitlist:notify: unresolved rows stay claimed so nobody is mailed twice. Check the Resend\n' +
        '  dashboard for those addresses, then delete the row to retry or set status to sent.\n',
    );
  }

  return tally[REJECTED] + tally[UNKNOWN];
}

function resolveCampaign(options) {
  const campaign = findCampaign(options.campaign);

  if (campaign === undefined) {
    throw new UsageError(
      `expected a known campaign; received ${options.campaign} — known campaigns are ${campaignNames().join(', ')}`,
    );
  }

  const missing = missingVariables(campaign, options.vars);

  if (missing.length > 0) {
    throw new UsageError(
      `campaign ${campaign.id} expects ${missing.join(', ')}; none supplied — ` +
        `pass --var ${missing[0]}=<value> (${campaign.requires[missing[0]]})`,
    );
  }

  return campaign;
}

async function main() {
  const require = createRequire(import.meta.url);
  const envFile = new URL('../.env', import.meta.url);

  if (existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile));

  const options = parseArgs(process.argv.slice(2));

  if (options.help || options.campaign === undefined) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const campaign = resolveCampaign(options);
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new UsageError(
      'expected DATABASE_URL to hold the Neon connection string; found none — copy .env.example to .env',
    );
  }

  const apiKey = process.env.RESEND_API_KEY;

  if (options.send && !apiKey) {
    throw new UsageError(
      'expected RESEND_API_KEY to hold the Resend key because --send was given; found none',
    );
  }

  const { Client } = require('pg');
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { rows: recipients } = await client.query(selectRecipientsSql(options.limit), [
      campaign.id,
    ]);
    const { rows: done } = await client.query(
      "SELECT count(*)::int AS n FROM waitlist_broadcast_send WHERE campaign = $1 AND status = 'sent'",
      [campaign.id],
    );

    process.stdout.write(
      `waitlist:notify: campaign ${campaign.id} — ${recipients.length} to send, ${done[0].n} already sent\n`,
    );
    await reportUnresolved(client, campaign.id);

    if (recipients.length === 0) {
      process.stdout.write('waitlist:notify: nothing to do\n');
      return;
    }

    if (!options.send) {
      const preview = renderCampaign(campaign, {
        unsubscribeToken: PREVIEW_TOKEN,
        vars: options.vars,
      });

      process.stdout.write('\nWould send to:\n');
      for (const row of recipients) process.stdout.write(`  ${row.email}\n`);
      process.stdout.write(`\nSubject: ${preview.subject}\n\n${preview.text}\n\n`);
      process.stdout.write(
        'waitlist:notify: dry run — nothing was sent. Re-run with --send to deliver.\n',
      );
      return;
    }

    const from = process.env.WAITLIST_FROM ?? 'Mneia <hello@mneia.dev>';
    const unhappy = await sendCampaign(client, { campaign, options, apiKey, from }, recipients);

    if (unhappy > 0) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`waitlist:notify: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write(`\n${usage()}\n`);
    process.exitCode = 1;
  }
}
