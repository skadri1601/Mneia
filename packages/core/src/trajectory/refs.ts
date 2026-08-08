export type RefFactory = (candidate: string) => string;

export function createRefFactory(): RefFactory {
  const seen = new Map<string, number>();
  return (candidate: string): string => {
    const occurrence = seen.get(candidate) ?? 0;
    seen.set(candidate, occurrence + 1);
    return occurrence === 0 ? candidate : `${candidate}~${occurrence}`;
  };
}
