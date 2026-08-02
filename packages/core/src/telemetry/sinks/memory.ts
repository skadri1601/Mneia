import type { TelemetryEvent, TelemetryEventName, TelemetrySink } from '../types.js';

export type TelemetryEventOf<TName extends TelemetryEventName> = Extract<
  TelemetryEvent,
  { readonly name: TName }
>;

export interface MemoryTelemetrySink extends TelemetrySink {
  readonly events: readonly TelemetryEvent[];
  readonly names: readonly TelemetryEventName[];
  readonly flushCount: number;
  readonly closeCount: number;
  eventsOf<TName extends TelemetryEventName>(name: TName): readonly TelemetryEventOf<TName>[];
  lastOf<TName extends TelemetryEventName>(name: TName): TelemetryEventOf<TName> | undefined;
  countOf(name: TelemetryEventName): number;
  saw(name: TelemetryEventName): boolean;
  clear(): void;
}

export interface MemorySinkOptions {
  readonly name?: string | undefined;
  readonly fail?: ((event: TelemetryEvent) => Error | null) | undefined;
}

const named =
  <TName extends TelemetryEventName>(name: TName) =>
  (event: TelemetryEvent): event is TelemetryEventOf<TName> =>
    event.name === name;

export function createMemorySink(options: MemorySinkOptions = {}): MemoryTelemetrySink {
  const events: TelemetryEvent[] = [];
  const fail = options.fail;
  let flushCount = 0;
  let closeCount = 0;

  return {
    name: options.name ?? 'memory',

    get events(): readonly TelemetryEvent[] {
      return events;
    },

    get names(): readonly TelemetryEventName[] {
      return events.map((event) => event.name);
    },

    get flushCount(): number {
      return flushCount;
    },

    get closeCount(): number {
      return closeCount;
    },

    write(event: TelemetryEvent): Promise<void> {
      const failure = fail?.(event) ?? null;
      if (failure !== null) {
        return Promise.reject(failure);
      }
      events.push(event);
      return Promise.resolve();
    },

    flush(): Promise<void> {
      flushCount += 1;
      return Promise.resolve();
    },

    close(): Promise<void> {
      closeCount += 1;
      return Promise.resolve();
    },

    eventsOf<TName extends TelemetryEventName>(name: TName): readonly TelemetryEventOf<TName>[] {
      return events.filter(named(name));
    },

    lastOf<TName extends TelemetryEventName>(name: TName): TelemetryEventOf<TName> | undefined {
      const matches = events.filter(named(name));
      return matches[matches.length - 1];
    },

    countOf(name: TelemetryEventName): number {
      return events.filter((event) => event.name === name).length;
    },

    saw(name: TelemetryEventName): boolean {
      return events.some((event) => event.name === name);
    },

    clear(): void {
      events.length = 0;
    },
  };
}
