/** Locally stored conversations and screenshots are kept this long after last use. */
export const DEFAULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface RetentionPolicy<T> {
  /** Last-used time of an item, in epoch milliseconds. */
  timeOf: (item: T) => number;
  maxItems: number;
  maxAgeMs: number;
  now?: number;
}

/**
 * Items to delete: everything older than `maxAgeMs`, then the oldest of the
 * remainder beyond `maxItems`.
 */
export function selectForEviction<T>(
  items: readonly T[],
  { timeOf, maxItems, maxAgeMs, now = Date.now() }: RetentionPolicy<T>,
): T[] {
  const cutoff = now - maxAgeMs;
  const expired = items.filter((item) => timeOf(item) < cutoff);
  const fresh = items
    .filter((item) => timeOf(item) >= cutoff)
    .sort((a, b) => timeOf(b) - timeOf(a));
  return [...expired, ...fresh.slice(maxItems)];
}

export function isExpired(
  time: number,
  maxAgeMs: number,
  now = Date.now(),
): boolean {
  return time < now - maxAgeMs;
}
