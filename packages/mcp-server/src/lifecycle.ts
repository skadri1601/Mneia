/**
 * Keeping the server alive while it is useful, and ending it when it is not.
 *
 * Written after four orphaned servers were found pegging a core each for eleven hours on a
 * laptop — 33.9 CPU-hours burned, and the only symptom anyone noticed was the fan. The
 * cause was two decisions that are individually reasonable and together unbounded: an
 * `uncaughtException` handler that logs "session continues" and returns, and a transport
 * close path that drains but never exits. A read that fails permanently then fails forever,
 * as fast as the event loop can retry it.
 *
 * Both halves are fixed here, and the second matters more than the first. An orphan that
 * idles is a leak somebody eventually notices; an orphan that spins is a thermal problem
 * on the user's machine that nothing reports.
 */

export interface LifecycleLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * How many faults inside FAULT_WINDOW_MS are treated as a loop rather than bad luck.
 *
 * Sized to be unreachable by real transient errors — a flaky network call that throws
 * twenty times in five seconds is not retrying, it is spinning — and low enough that a hot
 * loop is caught in the first second rather than after an hour of billed CPU.
 */
export const FAULT_LIMIT = 20;
export const FAULT_WINDOW_MS = 5_000;

export interface FaultBudget {
  /** Records a fault. Returns true once the budget is exhausted inside the window. */
  record(at: number): boolean;
}

export function createFaultBudget(
  limit: number = FAULT_LIMIT,
  windowMs: number = FAULT_WINDOW_MS,
): FaultBudget {
  const seen: number[] = [];
  return {
    record(at: number): boolean {
      seen.push(at);
      // Only the window matters, so anything older is dropped rather than counted. This is
      // what keeps a server that faults once an hour running for as long as it is useful.
      while (seen.length > 0 && at - (seen[0] as number) > windowMs) {
        seen.shift();
      }
      return seen.length >= limit;
    },
  };
}

/** The subset of `process` this needs, named so the wiring can be tested without one. */
export interface LifecycleProcess {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  exit(code: number): never;
}

/** The subset of `process.stdin` this needs. */
export interface LifecycleStdin {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface LifecycleOptions {
  readonly shutdown: () => Promise<void>;
  readonly logger: LifecycleLogger;
  readonly proc: LifecycleProcess;
  readonly stdin: LifecycleStdin;
  readonly now?: (() => number) | undefined;
  readonly budget?: FaultBudget | undefined;
}

/**
 * Wires every route out of the process, so none of them is a route to spinning instead.
 *
 * Four ways a session ends, and all of them exit:
 *
 * - a signal, which is the ordinary case
 * - stdin ending, which is what a client exiting looks like when the pipe is honest
 * - stdin erroring, which is what it looks like when the pipe is not
 * - faults arriving faster than a working server ever produces
 *
 * The third and fourth exist because of `npx`. On Windows it inserts `node npx-cli.js` and
 * `cmd.exe` between the client and this process, and those intermediates hold the stdin
 * handle open after the client dies — so the clean `end` never arrives, and what is left is
 * a pipe with no writer that fails every read.
 */
export function installLifecycle(options: LifecycleOptions): void {
  const now = options.now ?? Date.now;
  const budget = options.budget ?? createFaultBudget();
  let ending = false;

  const end = (code: number, reason: string): void => {
    if (ending) {
      return;
    }
    ending = true;
    void (async () => {
      options.logger.info(`${reason}; draining in-flight tool calls before exiting`);
      try {
        await options.shutdown();
      } catch (cause) {
        // Never let a failed drain keep the process alive. Exiting without flushing loses
        // at most the telemetry of one session; not exiting is what burned the CPU-hours.
        options.logger.warn(
          `shutdown did not complete cleanly: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
      options.proc.exit(code);
    })();
  };

  options.proc.on('SIGINT', () => {
    end(0, 'received SIGINT');
  });
  options.proc.on('SIGTERM', () => {
    end(0, 'received SIGTERM');
  });

  // The client went away. Under a direct spawn this is the whole story; under npx it is the
  // signal that never comes, which is why the fault budget below is not redundant with it.
  options.stdin.on('end', () => {
    end(0, 'stdin closed, so the client is gone');
  });
  options.stdin.on('close', () => {
    end(0, 'stdin closed, so the client is gone');
  });
  options.stdin.on('error', (cause: unknown) => {
    end(0, `stdin failed (${cause instanceof Error ? cause.message : String(cause)})`);
  });

  const fault = (kind: string, cause: unknown): void => {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (budget.record(now())) {
      options.logger.error(
        `${FAULT_LIMIT} ${kind}s in under ${FAULT_WINDOW_MS / 1000}s, the last being: ${message}. That is a loop rather than a session having a bad time, so this server is exiting instead of burning a core on it. Restart the MCP client to get a working server.`,
      );
      end(1, 'faulting in a loop');
      return;
    }
    options.logger.error(`${kind}, session continues: ${message}`);
  };

  options.proc.on('uncaughtException', (cause: unknown) => {
    fault('uncaught exception', cause);
  });
  options.proc.on('unhandledRejection', (cause: unknown) => {
    fault('unhandled rejection', cause);
  });
}
