import * as Sentry from '@sentry/nextjs';

type DataCollection = NonNullable<NonNullable<Parameters<typeof Sentry.init>[0]>['dataCollection']>;

export const NO_USER_CONTENT: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: false, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  stackFrameVariables: false,
};

export const REDACTED = '[redacted by error-reporting.ts]';

export const SCRUBBED_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-mneia-probe'];

const DENIED = new Set(SCRUBBED_HEADERS);

interface ScrubbableRequest {
  headers?: Record<string, string> | undefined;
  cookies?: unknown;
  data?: unknown;
  query_string?: unknown;
}

interface ScrubbableEvent {
  request?: ScrubbableRequest | undefined;
}

export const scrubRequestData = <TEvent extends ScrubbableEvent | null>(event: TEvent): TEvent => {
  const request = event?.request;

  if (request === undefined) {
    return event;
  }

  const headers = request.headers;
  if (headers !== undefined) {
    for (const name of Object.keys(headers)) {
      if (DENIED.has(name.toLowerCase())) {
        headers[name] = REDACTED;
      }
    }
  }

  delete request.data;
  delete request.cookies;
  delete request.query_string;

  return event;
};

export const routeOf = (request: Request): string => {
  try {
    return new URL(request.url).pathname;
  } catch {
    return 'unparseable';
  }
};

export const classOf = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

export interface RouteFailure {
  readonly route: string;
  readonly method: string;
  readonly errorClass: string;
}

export const describeRouteFailure = (request: Request, error: unknown): RouteFailure => ({
  route: routeOf(request),
  method: request.method,
  errorClass: classOf(error),
});

export const reportRouteFailure = (request: Request, error: unknown): RouteFailure => {
  const failure = describeRouteFailure(request, error);

  Sentry.captureException(error, {
    tags: {
      mneia_route: failure.route,
      mneia_method: failure.method,
      mneia_error_class: failure.errorClass,
    },
  });

  return failure;
};

/**
 * What Sentry did with the last event this process tried to send.
 *
 * `configured` only ever meant "a DSN string is set" — it could not see an org whose error
 * quota was exhausted, which is what happened on 2026-08-23: ingest answered every event
 * with 429 `error_usage_exceeded` and two real production 500s were discarded while
 * /api/health still read `configured`. A capability that reports its own configuration
 * rather than its own behaviour cannot report an outage in itself.
 *
 * `unproven` is deliberately a ready state. A deployment that has raised no errors has
 * sent nothing, and calling that a fault would make the six-hourly health watch cry wolf
 * on every quiet day. We claim a problem only once we have observed one.
 */
export type SentryDelivery = 'unproven' | 'delivering' | 'dropped';

interface TransportResponse {
  readonly statusCode?: number | undefined;
  readonly headers?: Readonly<Record<string, string | null>> | undefined;
}

let delivery: SentryDelivery = 'unproven';
let lastDropDetail: string | null = null;

export const RATE_LIMIT_HEADER = 'x-sentry-rate-limits';

export const recordSentryDelivery = (response: TransportResponse | undefined): SentryDelivery => {
  const status = response?.statusCode;
  const limits = response?.headers?.[RATE_LIMIT_HEADER] ?? null;

  // A 429, or any 2xx that still carries a rate-limit header, means Sentry accepted the
  // request and threw the payload away. Both are drops; only the first is an HTTP error.
  if (status === 429 || (limits !== null && limits !== '')) {
    delivery = 'dropped';
    lastDropDetail = limits ?? `HTTP ${String(status)}`;
    return delivery;
  }

  if (status !== undefined && status >= 400) {
    delivery = 'dropped';
    lastDropDetail = `Sentry refused the envelope with HTTP ${status}`;
    return delivery;
  }

  delivery = 'delivering';
  lastDropDetail = null;
  return delivery;
};

export const sentryDelivery = (): SentryDelivery => delivery;

export const sentryDropDetail = (): string | null => lastDropDetail;

export const resetSentryDelivery = (): void => {
  delivery = 'unproven';
  lastDropDetail = null;
};

/**
 * Attach the observer to a Sentry client.
 *
 * `afterSendEvent` fires with the transport's response, so a 429 is seen the moment it
 * happens. Once the SDK is inside a rate-limit backoff it stops sending and the hook goes
 * quiet, which is why the recorded state is sticky: the last thing we saw Sentry do is
 * still the truest thing we know about it.
 */
export const observeSentryDelivery = (client: {
  on: (hook: 'afterSendEvent', handler: (event: unknown, response: unknown) => void) => void;
}): void => {
  client.on('afterSendEvent', (_event, response) => {
    recordSentryDelivery(response as TransportResponse | undefined);
  });
};
