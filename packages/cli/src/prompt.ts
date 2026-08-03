import { createInterface, emitKeypressEvents } from 'node:readline';

export interface PromptChoice {
  readonly key: string;
  readonly label: string;
}

export interface Prompter {
  readonly interactive: boolean;
  key(question: string, choices: readonly PromptChoice[]): Promise<string>;
  edit(label: string, current: string): Promise<string>;
  close(): Promise<void>;
}

export interface PromptStreams {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
}

const ETX = String.fromCharCode(3);
const ESC = String.fromCharCode(27);
const CANCEL = 'cancel';

export class PromptCancelled extends Error {
  constructor() {
    super('the review was cancelled before every candidate was decided');
    this.name = 'PromptCancelled';
  }
}

export function choiceLine(choices: readonly PromptChoice[]): string {
  return choices.map((choice) => `[${choice.key}] ${choice.label}`).join('  ');
}

export function normalizeKey(sequence: string, name: string | undefined): string {
  if (sequence === ETX || sequence === ESC) {
    return CANCEL;
  }
  return (name ?? sequence).toLowerCase();
}

export function createPrompter(streams: PromptStreams): Prompter {
  const { input, output } = streams;
  const interactive = input.isTTY === true && output.isTTY === true;
  let closed = false;

  const readKey = (accepted: ReadonlySet<string>): Promise<string> =>
    new Promise((resolve, reject) => {
      emitKeypressEvents(input);
      const wasRaw = input.isRaw === true;
      if (input.setRawMode !== undefined) {
        input.setRawMode(true);
      }
      input.resume();

      const settle = (value: string | null, error: Error | null): void => {
        input.off('keypress', onKeypress);
        if (input.setRawMode !== undefined) {
          input.setRawMode(wasRaw);
        }
        input.pause();
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(value ?? '');
      };

      const onKeypress = (sequence: string, key: { name?: string } | undefined): void => {
        const pressed = normalizeKey(sequence, key?.name);
        if (pressed === CANCEL) {
          settle(null, new PromptCancelled());
          return;
        }
        if (!accepted.has(pressed)) {
          return;
        }
        output.write(`${pressed}\n`);
        settle(pressed, null);
      };

      input.on('keypress', onKeypress);
    });

  const readLine = (prefill: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const rl = createInterface({ input, output, terminal: true });
      rl.on('SIGINT', () => {
        rl.close();
        reject(new PromptCancelled());
      });
      rl.question('', (answer) => {
        rl.close();
        resolve(answer);
      });
      rl.write(prefill);
    });

  return {
    interactive,

    async key(question: string, choices: readonly PromptChoice[]): Promise<string> {
      if (!interactive || closed) {
        throw new PromptCancelled();
      }
      const accepted = new Set(choices.map((choice) => choice.key.toLowerCase()));
      output.write(`${question}\n  ${choiceLine(choices)}\n> `);
      return readKey(accepted);
    },

    async edit(label: string, current: string): Promise<string> {
      if (!interactive || closed) {
        throw new PromptCancelled();
      }
      output.write(`${label} — edit in place, Enter to keep\n> `);
      const answer = await readLine(current);
      return answer.trim().length === 0 ? current : answer;
    },

    close(): Promise<void> {
      closed = true;
      return Promise.resolve();
    },
  };
}
