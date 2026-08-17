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
