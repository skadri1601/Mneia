import { describe, expect, it } from 'vitest';
import { colorEnabled, createTheme, LOGO, plainTheme, shortenPath } from './session-theme.js';

const ESC = String.fromCharCode(27);

describe('colorEnabled', () => {
  it('paints an interactive terminal', () => {
    expect(colorEnabled({ isTty: true, env: {} })).toBe(true);
  });

  it('never paints a pipe', () => {
    expect(colorEnabled({ isTty: false, env: {} })).toBe(false);
  });

  it('honours NO_COLOR', () => {
    expect(colorEnabled({ isTty: true, env: { NO_COLOR: '1' } })).toBe(false);
  });

  it('ignores an empty NO_COLOR, which is not a request', () => {
    expect(colorEnabled({ isTty: true, env: { NO_COLOR: '' } })).toBe(true);
  });

  it('honours a dumb terminal', () => {
    expect(colorEnabled({ isTty: true, env: { TERM: 'dumb' } })).toBe(false);
  });
});

describe('createTheme', () => {
  it('emits escape sequences when painting', () => {
    const theme = createTheme({ isTty: true, env: {} });
    expect(theme.accent('x')).toContain(ESC);
    expect(theme.bold('x')).toContain(ESC);
    expect(theme.dim('x')).toContain(ESC);
  });

  it('closes every sequence it opens', () => {
    const theme = createTheme({ isTty: true, env: {} });
    for (const painted of [theme.accent('x'), theme.bold('x'), theme.dim('x')]) {
      expect(painted.endsWith(`${ESC}[0m`)).toBe(true);
      expect(painted).toContain('x');
    }
  });

  it('returns the text untouched when colour is off', () => {
    const theme = createTheme({ isTty: false, env: {} });
    expect(theme.accent('x')).toBe('x');
    expect(theme.bold('x')).toBe('x');
    expect(theme.dim('x')).toBe('x');
  });

  it('plainTheme never paints', () => {
    expect(plainTheme.accent('x')).toBe('x');
    expect(plainTheme.bold('x')).toBe('x');
    expect(plainTheme.dim('x')).toBe('x');
  });
});

describe('LOGO', () => {
  it('is three rows of equal width, so the text beside it lines up', () => {
    expect(LOGO).toHaveLength(3);
    const widths = new Set(LOGO.map((row) => [...row].length));
    expect(widths.size).toBe(1);
  });
});

describe('shortenPath', () => {
  it('replaces the home prefix with a tilde', () => {
    expect(shortenPath('/home/saad/stealth-startup', '/home/saad')).toBe('~/stealth-startup');
  });

  it('handles a Windows separator', () => {
    expect(shortenPath('C:\\Users\\kadri\\repo', 'C:\\Users\\kadri')).toBe('~\\repo');
  });

  it('returns a bare tilde for the home directory itself', () => {
    expect(shortenPath('/home/saad', '/home/saad')).toBe('~');
  });

  it('leaves a path outside home alone', () => {
    expect(shortenPath('/srv/app', '/home/saad')).toBe('/srv/app');
  });

  it('does not shorten a sibling directory that merely shares the prefix', () => {
    expect(shortenPath('/home/saadleigh/app', '/home/saad')).toBe('/home/saadleigh/app');
  });
});
