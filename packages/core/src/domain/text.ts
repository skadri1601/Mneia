const NULL_BYTE = String.fromCharCode(0);

export const NULL_BYTE_ERROR =
  'must not contain a null byte: Postgres text cannot store one, so strip it before sending';

export function isStorableText(value: string): boolean {
  return !value.includes(NULL_BYTE);
}
