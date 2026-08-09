export const REDACTED = '[redacted by scrub.ts]';

export const SCRUBBED_HEADERS = ['x-mneia-probe', 'authorization'];

const DENIED = new Set(SCRUBBED_HEADERS);

interface HeaderCarrier {
  request?: { headers?: Record<string, string> | undefined } | undefined;
}

export function scrubSensitiveHeaders<TEvent extends HeaderCarrier | null>(event: TEvent): TEvent {
  const headers = event?.request?.headers;

  if (headers === undefined) {
    return event;
  }

  for (const name of Object.keys(headers)) {
    if (DENIED.has(name.toLowerCase())) {
      headers[name] = REDACTED;
    }
  }

  return event;
}
