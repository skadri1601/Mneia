export interface CommandIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface CommandInvocation {
  readonly args: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
  readonly json: boolean;
  readonly io: CommandIo;
}

export interface CommandDefinition {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  run(invocation: CommandInvocation): Promise<number>;
}

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_NOT_CONFIGURED = 3;
export const EXIT_AUTH = 4;
export const EXIT_NETWORK = 5;
export const EXIT_FAILED = 1;

export type CliFailureKind = 'usage' | 'not_configured' | 'auth' | 'network' | 'failed';

const EXIT_BY_KIND: Readonly<Record<CliFailureKind, number>> = {
  usage: EXIT_USAGE,
  not_configured: EXIT_NOT_CONFIGURED,
  auth: EXIT_AUTH,
  network: EXIT_NETWORK,
  failed: EXIT_FAILED,
};

export class CliError extends Error {
  readonly kind: CliFailureKind;
  readonly fix: string;

  constructor(kind: CliFailureKind, message: string, fix: string) {
    super(message);
    this.name = 'CliError';
    this.kind = kind;
    this.fix = fix;
  }

  get exitCode(): number {
    return EXIT_BY_KIND[this.kind];
  }
}
