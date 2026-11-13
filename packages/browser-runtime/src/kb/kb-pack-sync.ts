/**
 * Automatic KB pack delivery (KB-RAG K26, D2): for each version the
 * organization policy sources (`kbPackSources`, D-DEL1), fetch the pack with
 * the SE's own session (D-DEL2), and store it through the same path as a
 * manual import, so parsing, the checksum, the signature, trust and expiry
 * are checked exactly the same way. A fetched pack never downgrades the
 * stored one (D-DEL6): any refusal keeps it and records why.
 *
 * This is the only network call the extension makes for the KB. It reaches
 * only the policy's URLs and sends no page data; each request leaves one row
 * in the send record (time, version, origin, status, outcome: no path, no
 * body).
 */
import {
  isKbSyncSuccess,
  KB_PACK_LIMITS,
  KB_PACK_SOURCE_VERSIONS,
  type KbDeliveryFailure,
  type KbPackInfo,
  type KbPackSourceVersion,
  type KbPackSync,
  type KbReplaceStop,
  type KbSyncOutcome,
  type KbSyncReason,
  type KbSyncRecord,
  type KbSyncResult,
  type KbSyncSendRow,
  kbPackCheckHours,
  kbPackSources,
  kbSyncBackoffMs,
  type OrgPolicyState,
} from "@apty/agent-core";
import { loadOrgPolicy } from "../runtime/org-policy.js";
import {
  indexedDbRecords,
  type KbPackStore,
  type KbRecords,
} from "../storage/kb-store.js";

export type {
  KbPackSync,
  KbSyncOutcome,
  KbSyncRecord,
  KbSyncResult,
  KbSyncSendRow,
} from "@apty/agent-core";
export { kbSyncBackoffMs } from "@apty/agent-core";

export const KB_SYNC_TIMEOUT_MS = 60_000;
const ACCEPTED_TYPES = new Set(["application/json", "text/plain"]);

export const kbSyncKey = (version: KbPackSourceVersion) => `sync:${version}`;

/** The stored check record of each sourced version. */
export async function readKbSyncRecords(
  records: KbRecords,
): Promise<Partial<Record<KbPackSourceVersion, KbSyncRecord>>> {
  const entries = await Promise.all(
    KB_PACK_SOURCE_VERSIONS.map(
      async (version) =>
        [version, await records.get<KbSyncRecord>(kbSyncKey(version))] as const,
    ),
  );
  return Object.fromEntries(entries.filter(([, record]) => record));
}

/** D-DEL6: the source's own version only, and newer by `builtAt` than the stored pack. */
function newerGuard(version: KbPackSourceVersion) {
  return (
    incoming: KbPackInfo,
    stored: KbPackInfo | undefined,
  ): Exclude<KbReplaceStop, "policy_managed"> | undefined => {
    if (incoming.aptyVersion !== version) return "version_mismatch";
    if (!stored) return undefined;
    if (incoming.sha256 === stored.sha256) return "unchanged";
    const built = Date.parse(incoming.builtAt);
    const kept = Date.parse(stored.builtAt);
    if (Number.isNaN(kept)) return undefined;
    return Number.isNaN(built) || built <= kept ? "older" : undefined;
  };
}

/** The body as text, or undefined past the pack limit, counted as it streams. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<string | undefined> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return new TextEncoder().encode(text).byteLength > maxBytes
      ? undefined
      : text;
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function mediaTypeOf(response: Response): string {
  const [type = ""] = (response.headers.get("content-type") ?? "").split(";");
  return type.trim().toLowerCase();
}

export function createKbPackSync({
  store,
  records,
  policy,
  fetch: fetchFn = (...args) => globalThis.fetch(...args),
  now = () => new Date(),
  record = async () => undefined,
  onUpdated = async () => undefined,
  timeoutMs = KB_SYNC_TIMEOUT_MS,
  maxBytes = KB_PACK_LIMITS.maxBytes,
}: {
  store: KbPackStore;
  /** The KB database's records store, where `sync:<version>` lives. */
  records: KbRecords;
  policy: () => Promise<OrgPolicyState>;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  /** Writes one send-record row per request. */
  record?: (row: KbSyncSendRow) => Promise<void>;
  /** Called after a version's pack was replaced. */
  onUpdated?: () => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
}): KbPackSync {
  let running: Promise<KbSyncResult[]> | null = null;
  const storedInfo = async (version: KbPackSourceVersion) =>
    (await store.info()).find((info) => info.aptyVersion === version);

  const fetchOne = async (
    version: KbPackSourceVersion,
    url: string,
    previous: KbSyncRecord | undefined,
  ): Promise<{
    outcome: KbSyncOutcome;
    httpStatus?: number;
    etag?: string;
    lastModified?: string;
    sha256?: string;
  }> => {
    const headers: Record<string, string> = {};
    if (previous?.etag) headers["If-None-Match"] = previous.etag;
    if (previous?.lastModified) {
      headers["If-Modified-Since"] = previous.lastModified;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "GET",
        credentials: "include",
        cache: "no-cache",
        redirect: "follow",
        headers,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      return { outcome: controller.signal.aborted ? "timeout" : "network" };
    }
    const httpStatus = response.status;
    try {
      if (httpStatus === 304) return { outcome: "not_modified", httpStatus };
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return { outcome: `http_${httpStatus}`, httpStatus };
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        return { outcome: "too_large", httpStatus };
      }
      if (!ACCEPTED_TYPES.has(mediaTypeOf(response))) {
        await response.body?.cancel().catch(() => undefined);
        return { outcome: "wrong_type", httpStatus };
      }
      let text: string | undefined;
      try {
        text = await readCapped(response, maxBytes);
      } catch {
        return {
          outcome: controller.signal.aborted ? "timeout" : "network",
          httpStatus,
        };
      }
      if (text === undefined) return { outcome: "too_large", httpStatus };
      const validators = {
        ...(response.headers.get("etag")
          ? { etag: response.headers.get("etag") as string }
          : {}),
        ...(response.headers.get("last-modified")
          ? { lastModified: response.headers.get("last-modified") as string }
          : {}),
      };
      const result = await store.replace(text, { guard: newerGuard(version) });
      if (result.ok) {
        return {
          outcome: "updated",
          httpStatus,
          sha256: result.info.sha256,
          ...validators,
        };
      }
      // Neither arises here: the text is in hand and the guard is the source's.
      if (result.code === "read_failed" || result.code === "policy_managed") {
        return { outcome: "network", httpStatus };
      }
      // The stored pack is the source's: keep the validators so the next check is a 304.
      return result.code === "unchanged"
        ? { outcome: "unchanged", httpStatus, ...validators }
        : { outcome: result.code, httpStatus };
    } finally {
      clearTimeout(timer);
    }
  };

  const syncVersion = async (
    version: KbPackSourceVersion,
    url: string,
    checkHours: number,
    reason: KbSyncReason,
  ): Promise<KbSyncResult> => {
    const previous = await records.get<KbSyncRecord>(kbSyncKey(version));
    const at = now();
    if (previous && reason !== "manual") {
      const wait = kbSyncBackoffMs(previous.failures, checkHours);
      if (at.getTime() - Date.parse(previous.lastCheckAt) < wait) {
        return { version, outcome: "deferred" };
      }
    }
    const parsed = new URL(url);
    const storedBefore = await storedInfo(version);
    const sameSource = previous?.host === parsed.host;
    // A conditional request only while the stored pack is the one the last check saw.
    const conditional =
      sameSource && storedBefore && storedBefore.sha256 === previous?.sha256
        ? previous
        : undefined;
    const result = await fetchOne(version, url, conditional);
    const success = isKbSyncSuccess(result.outcome);
    const stored = await storedInfo(version);
    const next: KbSyncRecord = {
      version,
      host: parsed.host,
      lastCheckAt: at.toISOString(),
      outcome: result.outcome,
      failures: success ? 0 : (sameSource ? (previous?.failures ?? 0) : 0) + 1,
      ...(success
        ? { lastSuccessAt: at.toISOString() }
        : sameSource && previous?.lastSuccessAt
          ? { lastSuccessAt: previous.lastSuccessAt }
          : {}),
      ...(result.httpStatus !== undefined
        ? { httpStatus: result.httpStatus }
        : {}),
      ...(stored ? { sha256: stored.sha256 } : {}),
      ...(result.outcome === "not_modified" && sameSource
        ? {
            ...(previous?.etag ? { etag: previous.etag } : {}),
            ...(previous?.lastModified
              ? { lastModified: previous.lastModified }
              : {}),
          }
        : {
            ...(result.etag ? { etag: result.etag } : {}),
            ...(result.lastModified
              ? { lastModified: result.lastModified }
              : {}),
          }),
    };
    await records.putAll([[kbSyncKey(version), next]]);
    await record({
      at: at.toISOString(),
      version,
      origin: parsed.origin,
      status: result.httpStatus ?? null,
      outcome: result.outcome,
    }).catch(() => undefined);
    if (result.outcome === "updated") await onUpdated().catch(() => undefined);
    return {
      version,
      outcome: result.outcome,
      ...(result.httpStatus !== undefined
        ? { httpStatus: result.httpStatus }
        : {}),
    };
  };

  const run = async (reason: KbSyncReason): Promise<KbSyncResult[]> => {
    const state = await policy();
    const sources = kbPackSources(state);
    const checkHours = kbPackCheckHours(state);
    const results: KbSyncResult[] = [];
    for (const version of KB_PACK_SOURCE_VERSIONS) {
      const url = sources[version];
      if (!url) continue;
      results.push(await syncVersion(version, url, checkHours, reason));
    }
    return results;
  };

  return {
    syncAll({ reason }) {
      running ??= run(reason).finally(() => {
        running = null;
      });
      return running;
    },
  };
}

/** For a version the KB has no usable pack for: the policy delivers it and its last check failed. */
export type KbDeliveryNote = (
  version: "4.x" | "5.x" | "common" | "unknown",
) => Promise<KbDeliveryFailure | undefined>;

/** @internal exported for tests, which give it records and a policy of their own. */
export function createKbDeliveryNote({
  records,
  policy,
}: {
  records: () => KbRecords;
  policy: () => Promise<OrgPolicyState>;
}): KbDeliveryNote {
  return async (version) => {
    try {
      const sources = kbPackSources(await policy());
      const versions = KB_PACK_SOURCE_VERSIONS.filter(
        (sourced) =>
          sources[sourced] && (version === "unknown" || sourced === version),
      );
      if (versions.length === 0) return undefined;
      const kept = await readKbSyncRecords(records());
      for (const sourced of versions) {
        const last = kept[sourced];
        if (last && !isKbSyncSuccess(last.outcome)) {
          return { version: sourced, outcome: last.outcome };
        }
      }
    } catch {
      // A note that cannot be read is left out; the KB line still says why.
    }
    return undefined;
  };
}

let sharedRecords: KbRecords | undefined;
let sharedNote: KbDeliveryNote | undefined;

/** The note over this browser's KB database and managed policy. */
export function sharedKbDeliveryNote(): KbDeliveryNote {
  sharedNote ??= createKbDeliveryNote({
    records: () => {
      sharedRecords ??= indexedDbRecords();
      return sharedRecords;
    },
    policy: loadOrgPolicy,
  });
  return sharedNote;
}
