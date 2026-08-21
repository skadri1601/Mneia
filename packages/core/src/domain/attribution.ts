const WHITESPACE_RUN = /\s+/g;

const META_FIELD_MARKERS = /[[\]()·]/g;

export const UNATTRIBUTED_ACTOR = 'unattributed';

export function sanitizeActorName(displayName: string): string {
  const cleaned = displayName.replace(META_FIELD_MARKERS, ' ').replace(WHITESPACE_RUN, ' ').trim();
  return cleaned === '' ? UNATTRIBUTED_ACTOR : cleaned;
}
