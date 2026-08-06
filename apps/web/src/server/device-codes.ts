import 'server-only';

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
const USER_CODE_GROUP = 4;
const USER_CODE_GROUPS = 2;

export const DEVICE_CODE_BYTES = 32;
export const API_TOKEN_BYTES = 32;
export const API_TOKEN_PREFIX = 'mneia_';

export interface DeviceCodePair {
  readonly deviceCode: string;
  readonly deviceCodeHash: string;
  readonly userCode: string;
  readonly confirmationCode: string;
}

export interface ApiTokenPair {
  readonly token: string;
  readonly tokenHash: string;
}

export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret, 'utf8').digest('hex');

const randomUserCodeGroup = (): string => {
  let group = '';
  for (let index = 0; index < USER_CODE_GROUP; index += 1) {
    group += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return group;
};

export const generateUserCode = (): string =>
  Array.from({ length: USER_CODE_GROUPS }, randomUserCodeGroup).join('-');

export const generateConfirmationCode = (): string => String(randomInt(1000, 10000));

export const generateDeviceCodePair = (): DeviceCodePair => {
  const deviceCode = randomBytes(DEVICE_CODE_BYTES).toString('base64url');
  return {
    deviceCode,
    deviceCodeHash: hashSecret(deviceCode),
    userCode: generateUserCode(),
    confirmationCode: generateConfirmationCode(),
  };
};

export const generateApiToken = (): ApiTokenPair => {
  const token = `${API_TOKEN_PREFIX}${randomBytes(API_TOKEN_BYTES).toString('base64url')}`;
  return { token, tokenHash: hashSecret(token) };
};

export const normalizeUserCode = (raw: string): string => {
  const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (stripped.length !== USER_CODE_GROUP * USER_CODE_GROUPS) return '';

  const groups: string[] = [];
  for (let index = 0; index < stripped.length; index += USER_CODE_GROUP) {
    groups.push(stripped.slice(index, index + USER_CODE_GROUP));
  }

  const candidate = groups.join('-');
  return isUserCodeShaped(candidate) ? candidate : '';
};

export const isUserCodeShaped = (candidate: string): boolean => {
  const groups = candidate.split('-');
  if (groups.length !== USER_CODE_GROUPS) return false;
  return groups.every(
    (group) =>
      group.length === USER_CODE_GROUP &&
      [...group].every((character) => USER_CODE_ALPHABET.includes(character)),
  );
};

export const confirmationCodeMatches = (expected: string, supplied: string): boolean => {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  if (expectedBytes.length !== suppliedBytes.length) return false;
  return timingSafeEqual(expectedBytes, suppliedBytes);
};

export const bearerTokenFrom = (header: string | null): string => {
  if (header === null) return '';
  const match = /^Bearer[ ]+(?<token>[\w.~+/-]+=*)$/.exec(header.trim());
  return match?.groups?.token ?? '';
};
