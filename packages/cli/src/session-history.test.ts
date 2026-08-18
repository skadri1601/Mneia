import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createHistoryStore,
  HISTORY_LIMIT,
  historyPath,
  parseHistory,
  rememberLine,
} from './session-history.js';

const tempHome = (): Promise<string> => mkdtemp(join(tmpdir(), 'mne12-history-'));

describe('rememberLine', () => {
  it('puts the newest line first', () => {
    expect(rememberLine(['older'], 'newer')).toEqual(['newer', 'older']);
  });

  it('does not record a blank line', () => {
    expect(rememberLine(['older'], '   ')).toEqual(['older']);
  });

  it('moves a repeated line to the front instead of duplicating it', () => {
    expect(rememberLine(['b', 'a'], 'a')).toEqual(['a', 'b']);
  });
});

describe('parseHistory', () => {
  it('returns the newest line first, because the file is appended to', () => {
    expect(parseHistory('first\nsecond\nthird\n')).toEqual(['third', 'second', 'first']);
  });

  it('keeps only the most recent occurrence of a repeated line', () => {
    expect(parseHistory('status\nbrief\nstatus\n')).toEqual(['status', 'brief']);
  });

  it('ignores blank lines', () => {
    expect(parseHistory('\n\nstatus\n\n')).toEqual(['status']);
  });

  it('stops at the limit rather than growing without bound', () => {
    const many = Array.from({ length: HISTORY_LIMIT + 50 }, (_, index) => `line ${index}`);
    expect(parseHistory(many.join('\n'))).toHaveLength(HISTORY_LIMIT);
  });
});

describe('historyPath', () => {
  it('sits inside MNEIA_HOME, so a test never writes to the real one', () => {
    const home = join(tmpdir(), 'mne12-home');
    expect(historyPath({ MNEIA_HOME: home })).toBe(join(home, 'history'));
  });
});

describe('createHistoryStore', () => {
  it('reads nothing when no history has ever been written', async () => {
    const home = await tempHome();
    expect(await createHistoryStore({ MNEIA_HOME: home }).read()).toEqual([]);
  });

  it('reads back what a previous session appended', async () => {
    const home = await tempHome();
    const store = createHistoryStore({ MNEIA_HOME: home });

    await store.append('/status');
    await store.append('fix the login redirect');

    expect(await createHistoryStore({ MNEIA_HOME: home }).read()).toEqual([
      'fix the login redirect',
      '/status',
    ]);
  });

  it('appends rather than replacing, so one session does not erase another', async () => {
    const home = await tempHome();
    await writeFile(join(home, 'history'), 'earlier\n', 'utf8');

    await createHistoryStore({ MNEIA_HOME: home }).append('later');

    expect(await readFile(join(home, 'history'), 'utf8')).toBe('earlier\nlater\n');
  });

  it('records nothing for a blank line', async () => {
    const home = await tempHome();
    const store = createHistoryStore({ MNEIA_HOME: home });

    await store.append('   ');

    expect(await store.read()).toEqual([]);
  });

  it('stays silent when the history file cannot be written', async () => {
    const store = createHistoryStore({ MNEIA_HOME: join(tmpdir(), 'mne12-missing', 'nested') });
    await expect(store.append('/status')).resolves.toBeUndefined();
  });
});
