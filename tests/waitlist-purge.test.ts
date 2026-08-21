import { describe, expect, it } from 'vitest';
import {
  ACCESS_OPENED_CAMPAIGNS,
  ADMITTED,
  accessOpenedAt,
  DEFAULT_MAX,
  describe as describeRows,
  EMAILED,
  elapsedDays,
  parseArgs,
  RETENTION_DAYS,
  reasonsFor,
  UsageError,
  usage,
} from '../scripts/waitlist-purge.mjs';

const NOW = new Date('2026-09-20T00:00:00.000Z');
const daysBefore = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('the retention window is the published one', () => {
  it('waits exactly the 30 days the privacy policy promises', () => {
    expect(RETENTION_DAYS).toBe(30);
  });

  it('treats only the campaign the waitlist consented to as access opening', () => {
    expect(ACCESS_OPENED_CAMPAIGNS).toEqual(['access-open']);
  });
});

describe('parseArgs', () => {
  it('deletes nothing unless --apply is given', () => {
    expect(parseArgs([])).toEqual({ apply: false, max: DEFAULT_MAX, help: false });
    expect(parseArgs(['--apply']).apply).toBe(true);
  });

  it('accepts a larger cap', () => {
    expect(parseArgs(['--apply', '--max', '500']).max).toBe(500);
  });

  it('rejects a cap that is not a whole number of at least one', () => {
    expect(() => parseArgs(['--max', '0'])).toThrow(UsageError);
    expect(() => parseArgs(['--max', 'lots'])).toThrow(/received lots/);
    expect(() => parseArgs(['--max'])).toThrow(/received nothing/);
  });

  it('rejects an unknown option rather than ignoring it before a delete', () => {
    expect(() => parseArgs(['--force'])).toThrow(/unrecognised option --force/);
  });

  it('rejects a positional argument, which would otherwise read as a target', () => {
    expect(() => parseArgs(['waitlist'])).toThrow(/takes no target/);
  });

  it('offers help', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });
});

describe('usage', () => {
  it('says the default is a dry run', () => {
    expect(usage()).toMatch(/Without --apply this prints what is due and deletes nothing/);
  });
});

describe('the clock starts at whichever access-open event came first', () => {
  it('takes the admission when only that happened', () => {
    const row = { admitted_at: daysBefore(40), emailed_at: null };
    expect(accessOpenedAt(row)).toEqual(daysBefore(40));
    expect(reasonsFor(row)).toEqual([ADMITTED]);
  });

  it('takes the email when the row was never approved', () => {
    const row = { admitted_at: null, emailed_at: daysBefore(31) };
    expect(accessOpenedAt(row)).toEqual(daysBefore(31));
    expect(reasonsFor(row)).toEqual([EMAILED]);
  });

  it('takes the earlier of the two when both happened', () => {
    const row = { admitted_at: daysBefore(10), emailed_at: daysBefore(31) };
    expect(accessOpenedAt(row)).toEqual(daysBefore(31));
    expect(reasonsFor(row)).toEqual([ADMITTED, EMAILED]);
  });
});

describe('the report', () => {
  it('names rows by id and never by address', () => {
    const rows = [
      {
        id: '3f1c2b9a-5d84-4c7e-9a11-2b6f8e0d4c73',
        email: 'someone@example.com',
        status: 'approved',
        admitted_at: daysBefore(31),
        emailed_at: null,
      },
    ];

    const lines = describeRows(rows, NOW).join('\n');

    expect(lines).toContain('3f1c2b9a-5d84-4c7e-9a11-2b6f8e0d4c73');
    expect(lines).toContain('31d since access opened');
    expect(lines).not.toContain('someone@example.com');
    expect(lines).not.toContain('@');
  });

  it('counts elapsed days from the earlier clock', () => {
    expect(elapsedDays({ admitted_at: daysBefore(45), emailed_at: daysBefore(2) }, NOW)).toBe(45);
  });
});
