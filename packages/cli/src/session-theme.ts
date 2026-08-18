import { homedir } from 'node:os';

export interface Theme {
  readonly accent: (text: string) => string;
  readonly bold: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly inverse: (text: string) => string;
}

export interface ThemeOptions {
  readonly isTty: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

const CSI = `${String.fromCharCode(27)}[`;
const RESET = `${CSI}0m`;
const ACCENT = `${CSI}38;2;41;151;255m`;
const BOLD = `${CSI}1m`;
const DIM = `${CSI}2m`;
const INVERSE = `${CSI}7m`;

export const LOGO: readonly string[] = ['█▄   ▄█', '█ ▀▄▀ █', '█     █'];

export const CLEAR_SCREEN = `${CSI}2J${CSI}H`;

const plain = (text: string): string => text;

export function colorEnabled(options: ThemeOptions): boolean {
  const { env } = options;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false;
  }
  if (env.TERM === 'dumb') {
    return false;
  }
  return options.isTty;
}

export function createTheme(options: ThemeOptions): Theme {
  if (!colorEnabled(options)) {
    return { accent: plain, bold: plain, dim: plain, inverse: plain };
  }
  return {
    accent: (text) => `${ACCENT}${text}${RESET}`,
    bold: (text) => `${BOLD}${text}${RESET}`,
    dim: (text) => `${DIM}${text}${RESET}`,
    inverse: (text) => `${INVERSE}${text}${RESET}`,
  };
}

export const plainTheme: Theme = { accent: plain, bold: plain, dim: plain, inverse: plain };

export function shortenPath(directory: string, home: string = homedir()): string {
  if (home.length === 0 || !directory.startsWith(home)) {
    return directory;
  }
  const rest = directory.slice(home.length);
  if (rest.length === 0) {
    return '~';
  }
  if (rest.startsWith('/') || rest.startsWith('\\')) {
    return `~${rest}`;
  }
  return directory;
}
