import { CliError } from '../command.js';

export interface DeviceCodeGrant {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly confirmationCode: string;
  readonly verificationUri: string;
  readonly verificationUriComplete: string;
  readonly expiresIn: number;
  readonly interval: number;
}

export interface IssuedToken {
  readonly accessToken: string;
  readonly workspaceId: string;
  readonly actorId: string;
}

export interface Identity {
  readonly actor: { readonly id: string; readonly displayName: string; readonly kind: string };
  readonly workspace: {
    readonly id: string;
    readonly slug: string;
    readonly displayName: string;
  };
  readonly team: { readonly id: string; readonly displayName: string };
}

export type PollOutcome =
  | { readonly kind: 'issued'; readonly token: IssuedToken }
  | { readonly kind: 'pending'; readonly interval: number }
  | { readonly kind: 'slow_down'; readonly interval: number }
  | { readonly kind: 'failed'; readonly error: CliError };

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const readObject = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const readString = (source: Readonly<Record<string, unknown>>, key: string): string => {
  const value = source[key];
  return typeof value === 'string' ? value : '';
};

const readNumber = (
  source: Readonly<Record<string, unknown>>,
  key: string,
  fallback: number,
): number => {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
};

const parseJson = async (response: Response): Promise<Readonly<Record<string, unknown>>> => {
  try {
    return readObject(await response.json());
  } catch {
    return {};
  }
};

const unreachable = (authUrl: string, cause: unknown): CliError =>
  new CliError(
    'network',
    `could not reach ${authUrl}: ${cause instanceof Error ? cause.message : String(cause)}`,
    'check your connection, or set MNEIA_AUTH_URL if you are pointing at a different install',
  );

export async function requestDeviceCode(
  authUrl: string,
  clientLabel: string,
  fetchImpl: Fetch,
): Promise<DeviceCodeGrant> {
  let response: Response;
  try {
    response = await fetchImpl(`${authUrl}/api/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_label: clientLabel }),
    });
  } catch (cause) {
    throw unreachable(authUrl, cause);
  }

  if (!response.ok) {
    throw new CliError(
      'failed',
      `${authUrl}/api/device/code answered ${response.status}`,
      'try again, and check MNEIA_AUTH_URL points at the Mneia web app',
    );
  }

  const body = await parseJson(response);
  const grant: DeviceCodeGrant = {
    deviceCode: readString(body, 'device_code'),
    userCode: readString(body, 'user_code'),
    confirmationCode: readString(body, 'confirmation_code'),
    verificationUri: readString(body, 'verification_uri'),
    verificationUriComplete: readString(body, 'verification_uri_complete'),
    expiresIn: readNumber(body, 'expires_in', 900),
    interval: readNumber(body, 'interval', 5),
  };

  if (grant.deviceCode === '' || grant.userCode === '' || grant.confirmationCode === '') {
    throw new CliError(
      'failed',
      `${authUrl}/api/device/code did not return a device code, a user code, and a confirmation code`,
      'check MNEIA_AUTH_URL points at the Mneia web app rather than the marketing site',
    );
  }

  return grant;
}

export async function pollForToken(
  authUrl: string,
  deviceCode: string,
  fetchImpl: Fetch,
): Promise<PollOutcome> {
  let response: Response;
  try {
    response = await fetchImpl(`${authUrl}/api/device/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode }),
    });
  } catch (cause) {
    return { kind: 'failed', error: unreachable(authUrl, cause) };
  }

  const body = await parseJson(response);

  if (response.ok) {
    const accessToken = readString(body, 'access_token');
    if (accessToken === '') {
      return {
        kind: 'failed',
        error: new CliError(
          'failed',
          `${authUrl}/api/device/token answered 200 with no access_token`,
          'try mneia login again',
        ),
      };
    }
    return {
      kind: 'issued',
      token: {
        accessToken,
        workspaceId: readString(body, 'workspace_id'),
        actorId: readString(body, 'actor_id'),
      },
    };
  }

  const error = readString(body, 'error');
  const description = readString(body, 'error_description');

  if (error === 'authorization_pending') {
    return { kind: 'pending', interval: readNumber(body, 'interval', 5) };
  }
  if (error === 'slow_down') {
    return { kind: 'slow_down', interval: readNumber(body, 'interval', 5) };
  }
  if (error === 'access_denied') {
    return {
      kind: 'failed',
      error: new CliError(
        'auth',
        description === '' ? 'the sign-in request was denied' : description,
        'run mneia login again if that was a mistake',
      ),
    };
  }
  if (error === 'expired_token') {
    return {
      kind: 'failed',
      error: new CliError(
        'auth',
        description === '' ? 'the sign-in request expired before it was approved' : description,
        'run mneia login again',
      ),
    };
  }

  return {
    kind: 'failed',
    error: new CliError(
      'auth',
      description === ''
        ? `${authUrl}/api/device/token answered ${response.status} ${error}`
        : description,
      'run mneia login again',
    ),
  };
}

export async function fetchIdentity(
  authUrl: string,
  token: string,
  fetchImpl: Fetch,
): Promise<Identity> {
  let response: Response;
  try {
    response = await fetchImpl(`${authUrl}/api/me`, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
  } catch (cause) {
    throw unreachable(authUrl, cause);
  }

  const body = await parseJson(response);

  if (response.status === 401) {
    const description = readString(body, 'error_description');
    throw new CliError(
      'auth',
      description === '' ? 'that token is not valid' : description,
      'run mneia login again',
    );
  }
  if (!response.ok) {
    throw new CliError(
      'failed',
      `${authUrl}/api/me answered ${response.status}`,
      'try again in a moment',
    );
  }

  const actor = readObject(body.actor);
  const workspace = readObject(body.workspace);
  const team = readObject(body.team);

  if (readString(actor, 'id') === '' || readString(workspace, 'id') === '') {
    throw new CliError(
      'failed',
      `${authUrl}/api/me did not return an actor and a workspace`,
      'check MNEIA_AUTH_URL points at the Mneia web app',
    );
  }

  return {
    actor: {
      id: readString(actor, 'id'),
      displayName: readString(actor, 'display_name'),
      kind: readString(actor, 'kind'),
    },
    workspace: {
      id: readString(workspace, 'id'),
      slug: readString(workspace, 'slug'),
      displayName: readString(workspace, 'display_name'),
    },
    team: { id: readString(team, 'id'), displayName: readString(team, 'display_name') },
  };
}
