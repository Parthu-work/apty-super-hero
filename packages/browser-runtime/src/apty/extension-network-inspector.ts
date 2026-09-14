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
import { recordEvidence } from "./evidence-store.js";
import { classifyLogEntry, type LogCategory } from "./log-classification.js";
import { redactSensitiveText } from "./redact.js";
import { ConfiguredServiceWorkerDiagnosticsProvider } from "./service-worker-diagnostics.js";
import type { AptyObservedResource } from "./types.js";

export type ExtensionCaptureEntry = AptyObservedResource;

export interface MatchedResource extends ExtensionCaptureEntry {
  resourceName: string;
  matchKind: "exact" | "path" | "fragment";
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
  | "unavailable";

export interface ConnectResult {
  connected: boolean;
  alreadyConnected?: boolean;
  extensionId?: string;
  error?: string;
  errorCode?: ConnectErrorCode;
}

const NOT_COOPERATING_MESSAGE =
  "The Apty Client extension is installed, but did not respond to the resource-inspection message contract. It needs to allowlist this extension's id under externally_connectable in its manifest and implement the apty-debug-agent:* message handlers (see service-worker-diagnostics.ts) before its resources/logs can be inspected.";

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
    return {
      connected: false,
      errorCode: "unavailable",
      error: status.error ?? NOT_COOPERATING_MESSAGE,
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

function resourceNameFor(url: string): string {
  const withoutQuery = url.split("?")[0] ?? url;
  const segments = withoutQuery.split("/").filter(Boolean);
  return segments[segments.length - 1] || withoutQuery;
}

/**
 * Match resources the Apty Client reported against a resource query.
 * Supports an exact filename (`segments.json`), a path/URL suffix
 * (`/api/segments.json`), and a substring fragment (`segments`). Ranked
 * exact > path > fragment, then most-recent-first, so ties (the same
 * resource fetched twice) resolve deterministically.
 */
export function matchResources(
  requests: ExtensionCaptureEntry[],
  resourceQuery: string,
): MatchedResource[] {
  const query = resourceQuery.trim().toLowerCase();
  if (!query) return [];
  const normalizedPath = query.replace(/^\/+/, "");

  const scored: Array<MatchedResource & { score: number }> = [];
  for (const req of requests) {
    if (!req.url) continue;
    const name = resourceNameFor(req.url);
    const lowerUrl = req.url.toLowerCase();
    const lowerName = name.toLowerCase();

    let matchKind: MatchedResource["matchKind"] | undefined;
    let score = 0;
    if (lowerName === query) {
      matchKind = "exact";
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

/**
 * List log entries the Apty Client's service worker reports. Records
 * warning/error-level entries as evidence (mirrors `get_runtime_diagnostics`'
 * selective recording for tabs); routine info-level entries are returned
 * but not persisted as evidence, to avoid flooding the bounded
 * per-conversation store.
 */
export async function listServiceWorkerLogs(
  conversationId: string | undefined,
  options: { onlyErrors?: boolean } = {},
): Promise<
  | { connected: false }
  | { connected: true; extensionId: string; logs: ExtensionLogEntry[] }
> {
  const active = activeExtensionByConversation.get(keyFor(conversationId));
  if (!active) return { connected: false };

  const provider = new ConfiguredServiceWorkerDiagnosticsProvider({
    extensionId: active.extensionId,
  });
  const rawLogs = await provider.getLogs();

  let logs: ExtensionLogEntry[] = rawLogs.map((l) => ({
    level: l.level,
    text: l.message,
    timestamp: l.timestamp,
    category: classifyLogEntry({ text: l.message, level: l.level }),
  }));

  for (const entry of logs) {
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

  if (options.onlyErrors) {
    logs = logs.filter((l) => l.level === "error" || l.level === "warn");
  }

  return { connected: true, extensionId: active.extensionId, logs };
}

// ---------------------------------------------------------------------------
// Response body retrieval
// ---------------------------------------------------------------------------

/** Preview cap for inline chat display — the full (redacted) body is always stored as evidence (see get_investigation_timeline), this just keeps the chat response readable. */
export const MAX_INLINE_BODY_CHARS = 8000;

const TEXTUAL_MIME_PATTERN =
  /^(text\/|application\/json|application\/javascript|application\/xml|application\/x-www-form-urlencoded)/i;

function isTextualMime(mimeType: string | undefined): boolean {
  return !mimeType || TEXTUAL_MIME_PATTERN.test(mimeType);
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

export type InspectResourceStatus =
  | "ok"
  | "not_connected"
  | "not_observed"
  | "failed"
  | "http_error"
  | "pending"
  | "body_unavailable";

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
  };
  observedResources?: string[];
  error?: string;
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
    const observedResources = Array.from(
      new Set(listed.resources.map((r) => resourceNameFor(r.url ?? ""))),
    ).filter(Boolean);
    return {
      found: false,
      status: "not_observed",
      resourceQuery,
      observedResources,
      error: `I connected to the Apty Client, but it did not report a matching observed request for: ${resourceQuery}`,
    };
  }

  if (best.failed) {
    return {
      found: true,
      status: "failed",
      resourceQuery,
      request: best,
      error: `${best.resourceName} was requested but failed.${best.errorText ? ` ${best.errorText}` : ""}`,
    };
  }
  if (best.status !== undefined && best.status >= 400) {
    return {
      found: true,
      status: "http_error",
      resourceQuery,
      request: best,
      error: `${best.resourceName} was requested but failed. Status: ${best.status}`,
    };
  }
  if (best.status === undefined) {
    return {
      found: true,
      status: "pending",
      resourceQuery,
      request: best,
      error:
        "The Apty Client observed this request but has not yet reported a response. Please try again shortly.",
    };
  }

  const body = await provider.getResourceBody(best.requestId);
  if (!body.found || body.body === undefined) {
    return {
      found: true,
      status: "body_unavailable",
      resourceQuery,
      request: best,
      error:
        "The request was observed, but the Apty Client did not provide the response body.",
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
  const truncated = !isBinary && fullLength > MAX_INLINE_BODY_CHARS;
  const preview = isBinary
    ? "<binary response body, not shown>"
    : truncated
      ? redacted.slice(0, MAX_INLINE_BODY_CHARS)
      : redacted;

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
      body: isBinary ? undefined : redacted,
    },
  });

  return {
    found: true,
    status: "ok",
    resourceQuery,
    request: best,
    response: {
      bodyPreview: preview,
      fullLength,
      truncated,
      isBinary,
      evidenceId: evidence.evidenceId,
    },
  };
}

/** Test/debug helper: how many conversations currently have an active extension connection. */
export function getActiveExtensionConnectionCount(): number {
  return activeExtensionByConversation.size;
}
