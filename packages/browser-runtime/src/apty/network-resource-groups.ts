/**
 * The Apty Client's calls grouped by resource, shared by Options' network
 * calls panel and the chat tools so both show the same rows. A resource is
 * a method plus a URL without its query string (the Client appends
 * `?timestamp=...` cache-busters, so the same file would otherwise look
 * like a new request each time). Callers pass URLs as the current redaction
 * mode shows them, never raw ones, so a group's key can be displayed.
 */

export interface GroupableCall {
  requestId: string;
  method: string;
  url: string;
  resourceName: string;
  timestamp: number;
  status?: number;
  failed?: boolean;
  hasBody?: boolean;
}

/** Calls of a resource tried for a body when the Client does not say which have one. */
export const MAX_BODY_TRIES = 3;

export function resourceKeyOf(method: string, url: string): string {
  return `${method.toUpperCase()} ${url.split(/[?#]/, 1)[0]}`;
}

/** A call that did not succeed: a network failure or an HTTP error. */
export function isFailedCall(call: GroupableCall): boolean {
  return call.failed === true || (call.status ?? 0) >= 400;
}

export interface ResourceGroup<T extends GroupableCall = GroupableCall> {
  key: string;
  method: string;
  /** The URL without its query string. */
  url: string;
  resourceName: string;
  /** Newest first. */
  calls: T[];
  count: number;
  failedCount: number;
  latest: T;
}

/** Newest first; calls with the same time keep the later-reported one first. */
function newestFirst<T extends GroupableCall>(calls: readonly T[]): T[] {
  return calls
    .map((call, index) => ({ call, index }))
    .sort((a, b) => b.call.timestamp - a.call.timestamp || b.index - a.index)
    .map(({ call }) => call);
}

/** One group per resource, the most recently called first. */
export function groupByResource<T extends GroupableCall>(
  calls: readonly T[],
): ResourceGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const call of calls) {
    const key = resourceKeyOf(call.method, call.url);
    const members = byKey.get(key);
    if (members) members.push(call);
    else byKey.set(key, [call]);
  }
  const groups = [...byKey.entries()].map(([key, members]) => {
    const sorted = newestFirst(members);
    const latest = sorted[0] as T;
    return {
      key,
      method: latest.method.toUpperCase(),
      url: latest.url.split(/[?#]/, 1)[0] ?? latest.url,
      resourceName: latest.resourceName,
      calls: sorted,
      count: sorted.length,
      failedCount: sorted.filter(isFailedCall).length,
      latest,
    };
  });
  return groups.sort((a, b) => b.latest.timestamp - a.latest.timestamp);
}

/**
 * The calls whose body is worth asking for, best first. A call the Client
 * says has a body comes first and only those are tried; with no such call,
 * those it does not rule out are tried, newest first, up to
 * `MAX_BODY_TRIES`; when it rules out every call, the newest is still asked
 * so the Client can say why it has no body.
 */
export function bodyCandidates<T extends GroupableCall>(
  callsNewestFirst: readonly T[],
): T[] {
  const withBody = callsNewestFirst.filter((call) => call.hasBody === true);
  const pool =
    withBody.length > 0
      ? withBody
      : callsNewestFirst.filter((call) => call.hasBody !== false);
  const candidates = pool.length > 0 ? pool : callsNewestFirst.slice(0, 1);
  return candidates.slice(0, MAX_BODY_TRIES);
}
