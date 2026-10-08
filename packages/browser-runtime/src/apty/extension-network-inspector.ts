/**
 * Apty Client extension resource/log inspection.
 *
 * V1 resource-agnostic retrieval: the user asks for a resource by name (or
 * a natural-language description the model turns into a resource query,
 * e.g. "segments.json", "app.json", "the flow configuration") and this
 * module finds the matching request the Apty Client extension itself
 * reports having observed, and returns its actual response body. No
 * resource name is ever hardcoded — matching is done generically against
 * whatever the Apty Client reports (see `matchResources`).
 *
 * TRANSPORT — cross-extension messaging, not chrome.debugger:
 * An earlier version of this module attached `chrome.debugger` directly to
 * the Apty Client extension's Service Worker target (mirroring
 * `network-capture-session.ts`'s tab-scoped CDP capture). That was verified
 * against a real Chrome build (not just this module's own mocked unit
 * tests) to be architecturally impossible: `chrome.debugger.attach()`
 * unconditionally fails with "Cannot access a chrome-extension:// URL of
 * different extension" whenever the target belongs to a different
 * extension than the caller — a hard Chrome security boundary with no
 * permission or flag that lifts it, regardless of unpacked/dev-mode status.
 * Every previous test mocked `chrome.debugger.attach()` to unconditionally
 * succeed, which is why this went undetected until tested against a real
 * browser.
 *
 * The only mechanism Chrome actually allows for this is
 * `chrome.runtime.sendMessage(extensionId, ...)` cross-extension messaging,
 * which requires the Apty Client to cooperate: its manifest must allowlist
 * this extension's id under `externally_connectable`, and its service
 * worker must implement the `apty-debug-agent:*` message contract (see
 * `service-worker-diagnostics.ts`, which already implemented this pattern
 * for status/logs — this module reuses the same
 * `ConfiguredServiceWorkerDiagnosticsProvider` rather than building a
 * second messaging mechanism, and only adds the resource-listing/body
 * message types). Without that cooperation, every call here reports a
 * clear "not connected" / "unavailable" result — never a fabricated one.
 *
 * IMPORTANT — not retroactive in spirit, but not this module's problem to
 * solve: unlike the old debugger-capture design, there is no "capture
 * window" here — the Apty Client's own service worker is responsible for
 * remembering what it fetched and answering truthfully when asked. If it
 * only tracks a bounded recent history, an old resource may no longer be
 * observable; `inspectResource` reports `not_observed` rather than
 * inventing history either way.
 */

import { redactSensitiveText } from "@apty/debug-contract";
import { recordEvidence } from "./evidence-store.js";
import { classifyLogEntry, type LogCategory } from "./log-classification.js";
import {
  decodeBase64Utf8,
  isTextualMime,
  MAX_INLINE_BODY_CHARS,
  resourceNameFor,
} from "./resource-body-utils.js";
import { ConfiguredServiceWorkerDiagnosticsProvider } from "./service-worker-diagnostics.js";
import type { AptyObservedResource, AptyServiceWorkerStatus } from "./types.js";

// Re-exported for existing consumers (apty/index.ts) — the canonical
// definition now lives in resource-body-utils.ts, shared with
// network-capture-session.ts's CDP-based body capture.
export { MAX_INLINE_BODY_CHARS };

export type ExtensionCaptureEntry = AptyObservedResource;

export interface MatchedResource extends ExtensionCaptureEntry {
  resourceName: string;
  matchKind: "exact" | "tolerant" | "path" | "fragment";
}

/** A log entry reported by the Apty Client's own service worker. */
export interface ExtensionLogEntry {
  level: string;
  text: string;
  timestamp: number;
  category: LogCategory;
}

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export function isValidExtensionId(id: string): boolean {
  return typeof id === "string" && EXTENSION_ID_PATTERN.test(id);
}

function chromeApi(): typeof chrome | undefined {
  return (globalThis as any).chrome as typeof chrome | undefined;
}

async function getManagedExtension(
  extensionId: string,
): Promise<chrome.management.ExtensionInfo | undefined> {
  const c = chromeApi();
  if (!c?.management?.get) return undefined;
  try {
    return await c.management.get(extensionId);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Per-conversation "active extension" bookkeeping.
//
// There is no persistent session to attach/detach with cross-extension
// messaging (every call is a stateless request/response) — this map only
// remembers which extension id a conversation last connected to, so
// inspect/list/logs calls don't need the id repeated every time (mirroring
// the previous UX) and get_apty_client_connection_status has something to
// report.
// ---------------------------------------------------------------------------

const UNSCOPED_KEY = "__unscoped__";

function keyFor(conversationId: string | undefined): string {
  return conversationId && conversationId !== "pending"
    ? conversationId
    : UNSCOPED_KEY;
}

interface ActiveExtension {
  extensionId: string;
  connectedAt: number;
}

const activeExtensionByConversation = new Map<string, ActiveExtension>();

export type ConnectErrorCode =
  | "invalid_extension_id"
  | "extension_not_found"
  | "not_allowlisted"
  | "bridge_missing"
  | "timeout"
  | "malformed_response"
  | "unavailable";

export interface ConnectResult {
  connected: boolean;
  alreadyConnected?: boolean;
  extensionId?: string;
  /** This extension's own ID, which the Client must allow-list. */
  agentExtensionId?: string;
  error?: string;
  errorCode?: ConnectErrorCode;
}

const PEER_FAILURE_CODES: Record<
  NonNullable<AptyServiceWorkerStatus["peerFailure"]>,
  ConnectErrorCode
> = {
  no_receiver: "not_allowlisted",
  no_response: "bridge_missing",
  timeout: "timeout",
  malformed_response: "malformed_response",
  send_failed: "unavailable",
};

const NOT_COOPERATING_MESSAGE =
  "The Apty Client extension is installed, but did not respond to the resource-inspection message contract. It needs to allowlist this extension's id under externally_connectable in its manifest and implement the apty-debug-agent:* message handlers (see service-worker-diagnostics.ts) before its resources/logs can be inspected.";

function agentExtensionId(): string | undefined {
  try {
    return chrome.runtime?.id;
  } catch {
    return undefined;
  }
}

/**
 * Verify `extensionId` is installed/enabled AND actually cooperates with
 * the resource-inspection message contract (never reports "connected" from
 * installation status alone). Idempotent for the same extension; replaces
 * an existing connection to a different one.
 */
export async function connectExtensionClient(
  conversationId: string | undefined,
  extensionId: string,
): Promise<ConnectResult> {
  const key = keyFor(conversationId);

  const existing = activeExtensionByConversation.get(key);
  if (existing?.extensionId === extensionId) {
    return { connected: true, alreadyConnected: true, extensionId };
  }

  if (!isValidExtensionId(extensionId)) {
    return {
      connected: false,
      errorCode: "invalid_extension_id",
      error:
        "Invalid Chrome extension ID. Please provide a valid Apty Client extension ID.",
    };
  }

  const ext = await getManagedExtension(extensionId);
  if (!ext || ext.enabled === false) {
    return {
      connected: false,
      errorCode: "extension_not_found",
      error:
        "The specified Apty Client extension could not be found or is not currently available.",
    };
  }

  const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId,
  });
  const status = await provider.getStatus();
  if (status.status !== "ok") {
    const ownId = agentExtensionId();
    return {
      connected: false,
      agentExtensionId: ownId,
      errorCode: status.peerFailure
        ? PEER_FAILURE_CODES[status.peerFailure]
        : "unavailable",
      error: [
        status.error ?? "The Apty Client did not answer.",
        ownId ? `This Agent's extension ID is ${ownId}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }

  activeExtensionByConversation.set(key, {
    extensionId,
    connectedAt: Date.now(),
  });
  return { connected: true, extensionId };
}

export interface DisconnectResult {
  disconnected: boolean;
  error?: string;
}

/** Forget the conversation's active extension id. There is no persistent session to tear down (cross-extension messaging is stateless), so this is pure bookkeeping. */
export async function disconnectExtensionClient(
  conversationId: string | undefined,
): Promise<DisconnectResult> {
  const key = keyFor(conversationId);
  if (!activeExtensionByConversation.has(key)) {
    return {
      disconnected: false,
      error: "No Apty Client connection is active for this conversation.",
    };
  }
  activeExtensionByConversation.delete(key);
  return { disconnected: true };
}

export type ExtensionConnectionStatus =
  | { connected: false }
  | { connected: true; extensionId: string; connectedAt: number };

export function getExtensionConnectionStatus(
  conversationId: string | undefined,
): ExtensionConnectionStatus {
  const active = activeExtensionByConversation.get(keyFor(conversationId));
  if (!active) return { connected: false };
  return {
    connected: true,
    extensionId: active.extensionId,
    connectedAt: active.connectedAt,
  };
}

// ---------------------------------------------------------------------------
// Resource matching (deterministic — never left to the model to guess)
// ---------------------------------------------------------------------------

/** Strip a trailing filename extension (`.json`, `.js`, ...), if any. */
function stripExtension(s: string): string {
  const idx = s.lastIndexOf(".");
  return idx > 0 ? s.slice(0, idx) : s;
}

/**
 * Conservatively strip a trailing plural `s` — only when the result is
 * non-empty and doesn't end in `ss` (so "status"/"address" aren't mangled
 * into "statu"/"addres"). Good enough for the common case this exists for
 * (`segments` ↔ `segment`), not a general English pluralization library.
 */
function singularize(s: string): string {
  if (s.length > 2 && s.endsWith("s") && !s.endsWith("ss")) {
    return s.slice(0, -1);
  }
  return s;
}

/**
 * Normalize a resource name/query for tolerant comparison: lowercase,
 * extension-optional, singular/plural-insensitive. `segments.json`,
 * `segment.json`, `Segments`, and `segment` all normalize to `segment`.
 */
function normalizeForTolerantMatch(s: string): string {
  return singularize(stripExtension(s.toLowerCase()));
}

/** Strip a URL's query string (`?...`) before matching — per spec, the query string is ignored for resource-name matching. */
function stripUrlQuery(url: string): string {
  const idx = url.indexOf("?");
  return idx === -1 ? url : url.slice(0, idx);
}

/**
 * Match resources the Apty Client reported against a resource query.
 * Tolerant of case, a missing/present filename extension, and singular vs.
 * plural (`segments.json` ↔ `segment.json`) — then an exact path/URL suffix
 * (`/api/segments.json`), then a substring fragment (`segments`). Ranked
 * exact > tolerant > path > fragment, then most-recent-first, so ties (the
 * same resource fetched twice, or two variants of the same name) resolve
 * deterministically. The query string of the candidate URL is never
 * considered part of its name.
 */
export function matchResources(
  requests: ExtensionCaptureEntry[],
  resourceQuery: string,
): MatchedResource[] {
  const query = resourceQuery.trim().toLowerCase();
  if (!query) return [];
  const normalizedPath = query.replace(/^\/+/, "");
  const normalizedQuery = normalizeForTolerantMatch(query);

  const scored: Array<MatchedResource & { score: number }> = [];
  for (const req of requests) {
    if (!req.url) continue;
    const name = resourceNameFor(req.url);
    const lowerUrl = stripUrlQuery(req.url.toLowerCase());
    const lowerName = name.toLowerCase();

    let matchKind: MatchedResource["matchKind"] | undefined;
    let score = 0;
    if (lowerName === query) {
      matchKind = "exact";
      score = 4;
    } else if (
      normalizedQuery.length > 0 &&
      normalizeForTolerantMatch(name) === normalizedQuery
    ) {
      matchKind = "tolerant";
      score = 3;
    } else if (lowerUrl.endsWith(`/${normalizedPath}`)) {
      matchKind = "path";
      score = 2;
    } else if (lowerUrl.includes(query)) {
      matchKind = "fragment";
      score = 1;
    }
    if (!matchKind) continue;
    scored.push({ ...req, resourceName: name, matchKind, score });
  }

  scored.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
  return scored.map(({ score: _score, ...rest }) => rest);
}

/** Bounded Levenshtein edit distance — safe on short resource names (capped length), used only to rank "did you mean" suggestions, never for matching itself. */
function levenshtein(a: string, b: string): number {
  const maxLen = 64;
  const s = a.slice(0, maxLen);
  const t = b.slice(0, maxLen);
  const rows = s.length + 1;
  const cols = t.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,
        d[i]![j - 1]! + 1,
        d[i - 1]![j - 1]! + cost,
      );
    }
  }
  return d[rows - 1]![cols - 1]!;
}

export interface ResourceSuggestion {
  resourceName: string;
  count: number;
}

/**
 * When nothing matched, suggest the closest observed resource names —
 * deduplicated with how many times each was observed, ranked by edit
 * distance to the query (closest first), capped at `limit`.
 */
export function suggestClosestResourceNames(
  requests: ExtensionCaptureEntry[],
  resourceQuery: string,
  limit = 5,
): ResourceSuggestion[] {
  const query = normalizeForTolerantMatch(resourceQuery.trim().toLowerCase());
  const counts = new Map<string, number>();
  for (const req of requests) {
    if (!req.url) continue;
    const name = resourceNameFor(req.url);
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([resourceName, count]) => ({
      resourceName,
      count,
      distance: levenshtein(query, normalizeForTolerantMatch(resourceName)),
    }))
    .sort((a, b) => a.distance - b.distance || b.count - a.count)
    .slice(0, limit)
    .map(({ resourceName, count }) => ({ resourceName, count }));
}

export type ListResourcesResult =
  | { connected: false; error?: string }
  | {
      connected: true;
      extensionId: string;
      resources: Array<ExtensionCaptureEntry & { resourceName: string }>;
    };

/** Ask the connected Apty Client extension what resources it has observed itself requesting. */
export async function listObservedResources(
  conversationId: string | undefined,
): Promise<ListResourcesResult> {
  const active = activeExtensionByConversation.get(keyFor(conversationId));
  if (!active) return { connected: false };

  const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId: active.extensionId,
  });
  const result = await provider.listResources();
  if (!result.ok) {
    return { connected: false, error: result.error };
  }

  return {
    connected: true,
    extensionId: active.extensionId,
    resources: result.resources.map((r) => ({
      ...r,
      resourceName: resourceNameFor(r.url ?? ""),
    })),
  };
}

const LOG_LEVEL_ORDER: Record<string, number> = {
  debug: 0,
  log: 1,
  info: 2,
  warn: 3,
  error: 4,
};

const DEFAULT_LOG_LIMIT = 50;
const MAX_LOG_MESSAGE_CHARS = 500;

export interface ListServiceWorkerLogsOptions {
  onlyErrors?: boolean;
  /** Only entries at or above this severity. Ignored if `onlyErrors` is set (which is equivalent to `minLevel: "warn"`). */
  minLevel?: keyof typeof LOG_LEVEL_ORDER;
  /** Max entries returned, most-recent-first. Default 50. */
  limit?: number;
  /** If true, don't truncate individual message text to 500 chars. */
  full?: boolean;
}

export interface ExtensionLogEntryOut extends ExtensionLogEntry {
  /** Present when this entry represents N≥2 consecutive identical (level+text) entries, collapsed into one. */
  repeatCount?: number;
  truncated?: boolean;
}

export interface ServiceWorkerLogsHeader {
  /** How many entries existed before `limit` was applied (after collapsing and level filtering). */
  totalBeforeLimit: number;
  returned: number;
  truncatedByLimit: boolean;
  countsByLevel: Record<string, number>;
}

/** Collapse consecutive entries with the same level+text into one, tagged with how many were collapsed. */
function collapseConsecutive(
  logs: ExtensionLogEntry[],
): ExtensionLogEntryOut[] {
  const out: ExtensionLogEntryOut[] = [];
  for (const entry of logs) {
    const prev = out[out.length - 1];
    if (prev && prev.level === entry.level && prev.text === entry.text) {
      prev.repeatCount = (prev.repeatCount ?? 1) + 1;
      prev.timestamp = entry.timestamp; // keep the most recent occurrence's time
      continue;
    }
    out.push({ ...entry });
  }
  return out;
}

/**
 * List log entries the Apty Client's service worker reports. Records
 * warning/error-level entries as evidence (mirrors `get_runtime_diagnostics`'
 * selective recording for tabs); routine info-level entries are returned
 * but not persisted as evidence, to avoid flooding the bounded
 * per-conversation store.
 *
 * Output is bounded and model-friendly by default: capped to `limit`
 * (default 50) most-recent entries, individual messages truncated to 500
 * chars (`full: true` to expand), consecutive identical lines collapsed
 * into one with a `repeatCount`, and a `header` summarizing counts per
 * level plus whether the limit cut anything off — so "empty" or "short"
 * never has to be guessed at by the model.
 */
export async function listServiceWorkerLogs(
  conversationId: string | undefined,
  options: ListServiceWorkerLogsOptions = {},
): Promise<
  | { connected: false }
  | {
      connected: true;
      extensionId: string;
      logs: ExtensionLogEntryOut[];
      header: ServiceWorkerLogsHeader;
    }
> {
  const active = activeExtensionByConversation.get(keyFor(conversationId));
  if (!active) return { connected: false };

  const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId: active.extensionId,
  });
  const rawLogs = await provider.getLogs();

  const allLogs: ExtensionLogEntry[] = rawLogs.map((l) => ({
    level: l.level,
    text: l.message,
    timestamp: l.timestamp,
    category: classifyLogEntry({ text: l.message, level: l.level }),
  }));

  for (const entry of allLogs) {
    const isSignificant = entry.level === "error" || entry.level === "warn";
    if (!isSignificant) continue;
    recordEvidence({
      conversationId,
      source: "service-worker",
      type: "service-worker-log",
      timestamp: entry.timestamp,
      tabId: null,
      scope: "shared",
      data: entry,
    });
  }

  const countsByLevel: Record<string, number> = {};
  for (const entry of allLogs) {
    countsByLevel[entry.level] = (countsByLevel[entry.level] ?? 0) + 1;
  }

  const minLevelFloor = options.onlyErrors
    ? (LOG_LEVEL_ORDER.warn ?? 0)
    : options.minLevel !== undefined
      ? (LOG_LEVEL_ORDER[options.minLevel] ?? 0)
      : 0;
  const filtered = allLogs.filter(
    (l) => (LOG_LEVEL_ORDER[l.level] ?? 0) >= minLevelFloor,
  );

  const collapsed = collapseConsecutive(filtered);
  const limit =
    options.limit && options.limit > 0 ? options.limit : DEFAULT_LOG_LIMIT;
  const limited = collapsed.slice(-limit);

  const logs: ExtensionLogEntryOut[] = limited.map((entry) => {
    if (options.full || entry.text.length <= MAX_LOG_MESSAGE_CHARS) {
      return entry;
    }
    return {
      ...entry,
      text: `${entry.text.slice(0, MAX_LOG_MESSAGE_CHARS)}… [truncated, pass full:true to expand]`,
      truncated: true,
    };
  });

  return {
    connected: true,
    extensionId: active.extensionId,
    logs,
    header: {
      totalBeforeLimit: collapsed.length,
      returned: logs.length,
      truncatedByLimit: collapsed.length > logs.length,
      countsByLevel,
    },
  };
}

// ---------------------------------------------------------------------------
// Response body retrieval
// ---------------------------------------------------------------------------

export type InspectResourceStatus =
  | "ok"
  | "not_connected"
  | "not_observed"
  | "failed"
  | "http_error"
  | "pending"
  | "body_unavailable";

/** A bounded, model-safe summary of a JSON response body — item count, top-level keys, and a small sample — so the model never receives a blind character-truncated slice of a large array that might cut off mid-item. The full body is always available separately via evidence (`get_evidence_json`). */
export interface JsonBodySummary {
  kind: "array" | "object";
  /** Total element count, when the body is a JSON array. */
  itemCount?: number;
  /** Keys of the top-level object, or of the first array element if it's an object. */
  topLevelKeys?: string[];
  /** First few elements (if an array) or the object itself (if small), already redacted. */
  sample: unknown;
}

export interface InspectResourceResult {
  found: boolean;
  status: InspectResourceStatus;
  resourceQuery: string;
  request?: MatchedResource;
  response?: {
    bodyPreview: string;
    fullLength: number;
    truncated: boolean;
    isBinary: boolean;
    evidenceId?: string;
    json?: JsonBodySummary;
  };
  observedResources?: string[];
  /** Populated when the query didn't match anything — the closest observed resource names, with how many times each was seen, so the model can suggest "did you mean X?" instead of just failing. */
  suggestions?: ResourceSuggestion[];
  /** Populated when more than one resource matched — the other candidates that were NOT chosen, so the answer can disclose it picked the most-recent/highest-ranked of several. */
  alsoMatched?: string[];
  error?: string;
}

const MAX_JSON_SAMPLE_ITEMS = 5;

/** Build a bounded, model-safe summary of a (already redacted) JSON-parseable body, or `undefined` if it doesn't parse as JSON. */
function summarizeJsonBody(text: string): JsonBodySummary | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (Array.isArray(parsed)) {
    const sample = parsed.slice(0, MAX_JSON_SAMPLE_ITEMS);
    const first = sample[0];
    const topLevelKeys =
      first && typeof first === "object" && !Array.isArray(first)
        ? Object.keys(first as Record<string, unknown>)
        : undefined;
    return {
      kind: "array",
      itemCount: parsed.length,
      topLevelKeys,
      sample,
    };
  }

  if (parsed && typeof parsed === "object") {
    return {
      kind: "object",
      topLevelKeys: Object.keys(parsed as Record<string, unknown>),
      sample: parsed,
    };
  }

  return undefined;
}

/** Find the resource matching `resourceQuery` among what the Apty Client reports observing, and retrieve its actual response body. Never fabricates a body — every non-"ok" status is an explicit, structured failure. */
export async function inspectResource(
  conversationId: string | undefined,
  resourceQuery: string,
): Promise<InspectResourceResult> {
  const active = activeExtensionByConversation.get(keyFor(conversationId));
  if (!active) {
    return {
      found: false,
      status: "not_connected",
      resourceQuery,
      error:
        "Not connected to an Apty Client Service Worker. Call connect_apty_client with an extension ID first.",
    };
  }

  const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId: active.extensionId,
  });
  const listed = await provider.listResources();
  if (!listed.ok) {
    return {
      found: false,
      status: "not_connected",
      resourceQuery,
      error: listed.error ?? NOT_COOPERATING_MESSAGE,
    };
  }

  const matches = matchResources(listed.resources, resourceQuery);
  const best = matches[0];
  if (!best) {
    const suggestions = suggestClosestResourceNames(
      listed.resources,
      resourceQuery,
    );
    const observedResources = Array.from(
      new Set(listed.resources.map((r) => resourceNameFor(r.url ?? ""))),
    ).filter(Boolean);
    return {
      found: false,
      status: "not_observed",
      resourceQuery,
      observedResources,
      suggestions,
      error:
        suggestions.length > 0
          ? `I connected to the Apty Client, but it did not report a matching observed request for "${resourceQuery}". Did you mean: ${suggestions.map((s) => `${s.resourceName} (seen ${s.count}×)`).join(", ")}?`
          : `I connected to the Apty Client, but it did not report any observed request matching: ${resourceQuery}`,
    };
  }

  const alsoMatched =
    matches.length > 1
      ? Array.from(
          new Set(
            matches
              .slice(1)
              .map((m) => m.resourceName)
              .filter((name) => name !== best.resourceName),
          ),
        )
      : undefined;

  if (best.failed) {
    return {
      found: true,
      status: "failed",
      resourceQuery,
      request: best,
      alsoMatched,
      error: `${best.resourceName} was requested but failed.${best.errorText ? ` ${best.errorText}` : ""}`,
    };
  }
  if (best.status === undefined) {
    return {
      found: true,
      status: "pending",
      resourceQuery,
      request: best,
      alsoMatched,
      error:
        "The Apty Client observed this request but has not yet reported a response. Please try again shortly.",
    };
  }

  // From here on, a response (of SOME status, including 4xx/5xx) exists —
  // always attempt to fetch the body. An HTTP error status never skips this:
  // the body of a 403/500 response is frequently the one piece of evidence
  // that explains the failure (e.g. an error message or access-denied body).
  const isHttpError = best.status >= 400;
  const body = await provider.getResourceBody(best.requestId);
  if (!body.found || body.body === undefined) {
    return {
      found: true,
      status: isHttpError ? "http_error" : "body_unavailable",
      resourceQuery,
      request: best,
      alsoMatched,
      error: isHttpError
        ? `${best.resourceName} returned HTTP ${best.status}, and the Apty Client did not provide the response body.`
        : "The request was observed, but the Apty Client did not provide the response body.",
    };
  }

  const textual = isTextualMime(best.mimeType);
  let text = "";
  let isBinary = !textual;
  if (textual) {
    try {
      text = body.base64Encoded ? decodeBase64Utf8(body.body) : body.body;
    } catch {
      isBinary = true;
    }
  }

  const redacted = isBinary ? "" : redactSensitiveText(text);
  const fullLength = redacted.length;
  const json = isBinary ? undefined : summarizeJsonBody(redacted);
  // A JSON body is summarized structurally (item count + sample), which is
  // always far smaller and more useful to the model than a blind character
  // slice of a potentially 100kB+ array — so its inline preview stays small
  // regardless of MAX_INLINE_BODY_CHARS. Non-JSON text keeps the existing
  // char-truncation behavior unchanged.
  const preview = isBinary
    ? "<binary response body, not shown>"
    : json
      ? JSON.stringify(json.sample)
      : fullLength > MAX_INLINE_BODY_CHARS
        ? redacted.slice(0, MAX_INLINE_BODY_CHARS)
        : redacted;
  const truncated = isBinary
    ? false
    : json
      ? json.kind === "array" && (json.itemCount ?? 0) > MAX_JSON_SAMPLE_ITEMS
      : fullLength > MAX_INLINE_BODY_CHARS;

  const evidence = recordEvidence({
    conversationId,
    source: "service-worker",
    type: "network-response",
    timestamp: Date.now(),
    tabId: null,
    scope: "shared",
    requestId: best.requestId,
    url: best.url,
    data: {
      extensionId: active.extensionId,
      resourceName: best.resourceName,
      status: best.status,
      mimeType: best.mimeType,
      isBinary,
      // The FULL redacted body (never truncated) — this is what
      // get_evidence_json reads from. The model-bound `response` above only
      // ever sees `preview`/`json.sample`, never this.
      body: isBinary ? undefined : redacted,
    },
  });

  return {
    found: true,
    status: isHttpError ? "http_error" : "ok",
    resourceQuery,
    request: best,
    alsoMatched,
    response: {
      bodyPreview: preview,
      fullLength,
      truncated,
      isBinary,
      evidenceId: evidence.evidenceId,
      json,
    },
  };
}

/** Test/debug helper: how many conversations currently have an active extension connection. */
export function getActiveExtensionConnectionCount(): number {
  return activeExtensionByConversation.size;
}
