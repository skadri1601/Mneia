import { describe, expect, it, vi } from 'vitest';
import {
  createFaultBudget,
  DRAIN_TIMEOUT_MS,
  FAULT_LIMIT,
  FAULT_WINDOW_MS,
  installLifecycle,
  type LifecycleLogger,
} from './lifecycle.js';

function harness(opts: { destroyed?: boolean; shutdown?: () => Promise<void> } = {}) {
  const handlers = new Map<string, (arg?: unknown) => void>();
  const stdinHandlers = new Map<string, (arg?: unknown) => void>();
  const exits: number[] = [];
  const logs: string[] = [];

  const logger: LifecycleLogger = {
    info: (m) => logs.push(`info: ${m}`),
    warn: (m) => logs.push(`warn: ${m}`),
    error: (m) => logs.push(`error: ${m}`),
  };

  const shutdown = vi.fn(opts.shutdown ?? (async () => {}));

  let clock = 0;
  installLifecycle({
    shutdown,
    logger,
    proc: {
      on: (event, listener) => handlers.set(event, listener as (arg?: unknown) => void),
      exit: ((code: number) => {
        exits.push(code);
        // Real process.exit never returns; the tests need it to, so the caller can assert.
        return undefined as never;
      }) as (code: number) => never,
    },
    stdin: {
      on: (event, listener) => stdinHandlers.set(event, listener as (arg?: unknown) => void),
      destroyed: opts.destroyed ?? false,
    },
    now: () => clock,
  });

  return {
    fire: (event: string, arg?: unknown) => handlers.get(event)?.(arg),
    fireStdin: (event: string, arg?: unknown) => stdinHandlers.get(event)?.(arg),
    advance: (ms: number) => {
      clock += ms;
    },
    exits,
    logs,
    shutdown,
  };
}

const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('the fault budget', () => {
  it('tolerates faults that are spread out, because those are a bad day not a loop', () => {
    const budget = createFaultBudget(3, 1000);

    expect(budget.record(0)).toBe(false);
    expect(budget.record(2000)).toBe(false);
    expect(budget.record(4000)).toBe(false);
  });

  it('trips once the limit is reached inside the window', () => {
    const budget = createFaultBudget(3, 1000);

    expect(budget.record(0)).toBe(false);
    expect(budget.record(10)).toBe(false);
    expect(budget.record(20)).toBe(true);
  });

  it('is sized so a real transient error cannot trip it', () => {
    // Twenty throws inside five seconds is not a retry, and the numbers are asserted here
    // rather than trusted to the comment beside them.
    expect(FAULT_LIMIT).toBeGreaterThanOrEqual(10);
    expect(FAULT_WINDOW_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('the server lifecycle', () => {
  it('exits when stdin ends, because that is the client going away', async () => {
    const h = harness();

    h.fireStdin('end');
    await settle();

    expect(h.shutdown).toHaveBeenCalledOnce();
    expect(h.exits).toEqual([0]);
  });

  it('exits when stdin errors, which is the npx-orphan case', async () => {
    const h = harness();

    // Under npx the intermediates hold the handle open, so the clean `end` never arrives
    // and a failing read is the only signal left.
    h.fireStdin('error', new Error('EBADF: bad file descriptor'));
    await settle();

    expect(h.exits).toEqual([0]);
    expect(h.logs.join(' ')).toContain('EBADF');
  });

  it('keeps serving through an isolated fault, because one bad call is not a dead server', async () => {
    const h = harness();

    h.fire('uncaughtException', new Error('one bad tool call'));
    await settle();

    expect(h.exits).toEqual([]);
    expect(h.logs.join(' ')).toContain('session continues');
  });

  it('exits rather than spinning once faults arrive in a loop', async () => {
    const h = harness();

    for (let i = 0; i < FAULT_LIMIT; i += 1) {
      h.fire('uncaughtException', new Error('EPIPE: broken pipe'));
    }
    await settle();

    // This is the whole point: the old handler logged and returned, so a permanently
    // failing read was retried as fast as the event loop allowed - 33.9 CPU-hours of it.
    expect(h.exits).toEqual([1]);
    expect(h.logs.join(' ')).toContain('burning a core');
  });

  it('counts unhandled rejections toward the same budget', async () => {
    const h = harness();

    for (let i = 0; i < FAULT_LIMIT; i += 1) {
      h.fire('unhandledRejection', 'the store is gone');
    }
    await settle();

    expect(h.exits).toEqual([1]);
  });

  it('does not trip when faults are spread beyond the window', async () => {
    const h = harness();

    for (let i = 0; i < FAULT_LIMIT * 3; i += 1) {
      h.fire('uncaughtException', new Error('occasional'));
      h.advance(FAULT_WINDOW_MS + 1);
    }
    await settle();

    expect(h.exits).toEqual([]);
  });

  it('exits on a signal, draining first', async () => {
    const h = harness();

    h.fire('SIGTERM');
    await settle();

    expect(h.shutdown).toHaveBeenCalledOnce();
    expect(h.exits).toEqual([0]);
  });

  it('ends once even when several routes fire together', async () => {
    const h = harness();

    h.fireStdin('end');
    h.fireStdin('close');
    h.fire('SIGTERM');
    await settle();

    expect(h.shutdown).toHaveBeenCalledOnce();
    expect(h.exits).toEqual([0]);
  });

  it('still exits when the drain itself fails', async () => {
    const handlers = new Map<string, (arg?: unknown) => void>();
    const exits: number[] = [];
    const logs: string[] = [];

    installLifecycle({
      shutdown: async () => {
        throw new Error('the telemetry sink hung');
      },
      logger: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      proc: {
        on: (event, listener) => handlers.set(event, listener as (arg?: unknown) => void),
        exit: ((code: number) => {
          exits.push(code);
          return undefined as never;
        }) as (code: number) => never,
      },
      stdin: { on: () => undefined },
    });

    handlers.get('SIGTERM')?.();
    await settle();

    // A failed drain loses one session's telemetry. Not exiting loses a core.
    expect(exits).toEqual([0]);
    expect(logs.join(' ')).toContain('the telemetry sink hung');
  });
});

describe('the exit is never gated behind I/O', () => {
  it('exits on the deadline when the drain never resolves', async () => {
    // The defect this whole file exists for, twice over. The first fix awaited shutdown() and
    // then exited, which is no exit at all when the drain hangs - and it hangs exactly when it
    // matters, because draining talks to the transport that just died. Thirteen servers were
    // found spinning on 2026-08-29 running that fix.
    vi.useFakeTimers();
    try {
      const h = harness({ shutdown: () => new Promise<void>(() => {}) });

      h.fireStdin('end');
      await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS + 1);

      expect(h.exits).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits once, not twice, when a slow drain finishes after the deadline', async () => {
    vi.useFakeTimers();
    try {
      let release: (() => void) | undefined;
      const h = harness({
        shutdown: () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      });

      h.fireStdin('end');
      await vi.advanceTimersByTimeAsync(DRAIN_TIMEOUT_MS + 1);
      expect(h.exits).toEqual([0]);

      release?.();
      await vi.advanceTimersByTimeAsync(10);

      // A second exit would be harmless in production and misleading here; the guard is real.
      expect(h.exits).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait for the deadline when the drain is quick', async () => {
    vi.useFakeTimers();
    try {
      const h = harness();

      h.fire('SIGTERM');
      await vi.advanceTimersByTimeAsync(1);

      expect(h.exits).toEqual([0]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a fault while the client is already gone', () => {
  it('exits on the first one, without waiting for the budget to fill', async () => {
    const h = harness({ destroyed: true });

    h.fire('uncaughtException', new Error('ERR_STREAM_DESTROYED'));
    await settle();

    expect(h.exits).toEqual([1]);
    expect(h.logs.join(' ')).toContain('nothing left to serve');
  });

  it('stays silent and does no work once it is already ending', async () => {
    const h = harness({ destroyed: true });

    h.fire('uncaughtException', new Error('first'));
    const after = h.logs.length;
    for (let i = 0; i < 500; i += 1) {
      h.fire('uncaughtException', new Error('flood'));
    }
    await settle();

    // Every line written here is a write inside the loop the exit is escaping. On the
    // profiled spinners this path was 15% of the CPU burn.
    expect(h.logs.length).toBe(after);
    expect(h.exits).toEqual([1]);
  });
});
