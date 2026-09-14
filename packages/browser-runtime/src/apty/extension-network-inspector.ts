/**
 * Apty Client extension Service Worker network inspection.
 *
 * V1 resource-agnostic retrieval: the user asks for a resource by name (or
 * a natural-language description the model turns into a resource query,
 * e.g. "segments.json", "app.json", "the flow configuration") and this
 * module finds the matching request observed on the Apty Client extension's
 * Service Worker and returns its actual response body. No resource name is
 * ever hardcoded — matching is done generically against whatever requests
 * were actually observed (see `matchResources`).
 *
 * Mechanics mirror `network-capture-session.ts` (per-conversation capture,
 * bounded request map, forced cleanup on external detach/uninstall) but
 * target a Chrome extension's Service Worker via `chrome.debugger`'s
 * `targetId` debuggee instead of a tab's `tabId` — `cdp-commander.ts` and
 * `debugger-manager.ts` are hardcoded to `{ tabId }` debuggees, so this
 * module talks to `chrome.debugger` directly for the small set of
 * target-scoped operations it needs (attach/detach/sendCommand), rather
 * than bolting a second debuggee shape onto infrastructure that assumes
 * tabs everywhere.
 *
 * IMPORTANT — not retroactive: CDP only sees Network events that occur
 * after `Network.enable` was sent for this target. A resource the Service
 * Worker already fetched before `connect_apty_client` ran is invisible —
 * `inspectResource` reports `not_observed` rather than inventing history.
 */
import { recordEvidence } from "./evidence-store.js";
import { redactSensitiveText } from "./redact.js";

export interface ExtensionCaptureEntry {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  timestamp: number;
}

export interface MatchedResource extends ExtensionCaptureEntry {
  resourceName: string;
  matchKind: "exact" | "path" | "fragment";
}

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/;

export function isValidExtensionId(id: string): boolean {
  return typeof id === "string" && EXTENSION_ID_PATTERN.test(id);
}

function chromeApi(): typeof chrome | undefined {
  return (globalThis as any).chrome as typeof chrome | undefined;
}

// ---------------------------------------------------------------------------
// Low-level, target-scoped CDP plumbing (chrome.debugger doesn't limit
// attach/sendCommand/detach to tabs — a debuggee can also be `{ targetId }`,
// which is what an extension's Service Worker target requires).
// ---------------------------------------------------------------------------

function attachToTarget(
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const c = chromeApi();
    if (!c?.debugger) {
      resolve({ ok: false, error: "chrome.debugger API is not available" });
      return;
    }
    c.debugger.attach({ targetId }, "1.3", () => {
      if (c.runtime.lastError) {
        resolve({
          ok: false,
          error: c.runtime.lastError.message ?? "Failed to attach debugger",
        });
      } else {
        resolve({ ok: true });
      }
    });
  });
}

function detachFromTarget(targetId: string): Promise<void> {
  return new Promise((resolve) => {
    const c = chromeApi();
    if (!c?.debugger?.detach) {
      resolve();
      return;
    }
    c.debugger.detach({ targetId }, () => resolve());
  });
}

const DEFAULT_CDP_TIMEOUT_MS = 10_000;

function sendCommandToTarget<T = unknown>(
  targetId: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number = DEFAULT_CDP_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const c = chromeApi();
    if (!c?.debugger) {
      reject(new Error("chrome.debugger API is not available"));
      return;
    }
    const timer = setTimeout(() => {
      reject(
        new Error(`CDP command '${method}' timed out after ${timeoutMs}ms`),
      );
    }, timeoutMs);
    c.debugger.sendCommand({ targetId }, method, params, (result) => {
      clearTimeout(timer);
      if (c.runtime.lastError) {
        reject(
          new Error(
            `CDP command '${method}' failed: ${c.runtime.lastError.message}`,
          ),
        );
      } else {
        resolve(result as T);
      }
    });
  });
}

function getDebuggerTargets(): Promise<chrome.debugger.TargetInfo[]> {
  const c = chromeApi();
  if (!c?.debugger?.getTargets) return Promise.resolve([]);
  return new Promise((resolve) => {
    c.debugger.getTargets((targets) => resolve(targets ?? []));
  });
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
// Extension + Service Worker target resolution
// ---------------------------------------------------------------------------

export type ResolveTargetErrorCode =
  | "invalid_extension_id"
  | "extension_not_found"
  | "service_worker_unavailable";

export interface ResolveTargetResult {
  ok: boolean;
  target?: chrome.debugger.TargetInfo;
  errorCode?: ResolveTargetErrorCode;
  message?: string;
}

/** Validate the extension ID, confirm it's installed/enabled, and find its active Service Worker debugger target. Never invents a target — each failure mode is reported explicitly (see MASTER PROMPT section 14). */
export async function resolveServiceWorkerTarget(
  extensionId: string,
): Promise<ResolveTargetResult> {
  if (!isValidExtensionId(extensionId)) {
    return {
      ok: false,
      errorCode: "invalid_extension_id",
      message:
        "Invalid Chrome extension ID. Please provide a valid Apty Client extension ID.",
    };
  }

  const ext = await getManagedExtension(extensionId);
  if (!ext || ext.enabled === false) {
    return {
      ok: false,
      errorCode: "extension_not_found",
      message:
        "The specified Apty Client extension could not be found or is not currently available.",
    };
  }

  const targets = await getDebuggerTargets();
  const prefix = `chrome-extension://${extensionId}/`;
  // @types/chrome's TargetInfo["type"] union predates Manifest V3 service
  // workers and doesn't include "service_worker" as a literal, even though
  // Chrome reports it at runtime — compare as a plain string.
  const target = targets.find(
    (t) => (t.type as string) === "service_worker" && t.url?.startsWith(prefix),
  );
  if (!target) {
    return {
      ok: false,
      errorCode: "service_worker_unavailable",
      message:
        "The Apty Client Service Worker target is not currently available.",
    };
  }

  return { ok: true, target };
}

// ---------------------------------------------------------------------------
// Per-conversation capture session
// ---------------------------------------------------------------------------

interface ActiveExtensionSession {
  extensionId: string;
  targetId: string;
  connectedAt: number;
  requests: Map<string, ExtensionCaptureEntry>;
  truncated: boolean;
  listener: (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => void;
}

/** Bounded like network-capture-session.ts's MAX_CAPTURED_REQUESTS — an extension Service Worker can be long-lived and noisy. */
export const MAX_CAPTURED_RESOURCES = 1000;

const UNSCOPED_KEY = "__unscoped__";

function keyFor(conversationId: string | undefined): string {
  return conversationId && conversationId !== "pending"
    ? conversationId
    : UNSCOPED_KEY;
}

const sessionsByConversation = new Map<string, ActiveExtensionSession>();

function teardown(key: string, session: ActiveExtensionSession): void {
  sessionsByConversation.delete(key);
  chromeApi()?.debugger?.onEvent.removeListener(session.listener);
}

function forceCleanupForTarget(targetId: string): void {
  for (const [key, session] of sessionsByConversation.entries()) {
    if (session.targetId === targetId) teardown(key, session);
  }
}

function forceCleanupForExtension(extensionId: string): void {
  for (const [key, session] of sessionsByConversation.entries()) {
    if (session.extensionId === extensionId) teardown(key, session);
  }
}

let cleanupListenersRegistered = false;

/** Registered lazily, once — mirrors network-capture-session.ts's own lazy registration so importing this module in a non-extension context (e.g. a test) never throws on a missing `chrome` global. */
function ensureCleanupListenersRegistered(): void {
  if (cleanupListenersRegistered) return;
  const c = chromeApi();
  if (!c) return;
  cleanupListenersRegistered = true;

  c.debugger?.onDetach?.addListener((source) => {
    if (source.targetId !== undefined) forceCleanupForTarget(source.targetId);
  });
  c.management?.onUninstalled?.addListener((extensionId: string) => {
    forceCleanupForExtension(extensionId);
  });
  c.management?.onDisabled?.addListener((info: { id: string }) => {
    forceCleanupForExtension(info.id);
  });
}

export interface ConnectResult {
  connected: boolean;
  alreadyConnected?: boolean;
  extensionId?: string;
  targetId?: string;
  error?: string;
  errorCode?:
    | ResolveTargetErrorCode
    | "attach_failed"
    | "network_enable_failed";
}

/** Connect (attach + start capturing) to `extensionId`'s Service Worker for this conversation. Idempotent for the same extension; replaces an existing connection to a different one. */
export async function connectExtensionClient(
  conversationId: string | undefined,
  extensionId: string,
): Promise<ConnectResult> {
  ensureCleanupListenersRegistered();
  const key = keyFor(conversationId);

  const existing = sessionsByConversation.get(key);
  if (existing) {
    if (existing.extensionId === extensionId) {
      return {
        connected: true,
        alreadyConnected: true,
        extensionId,
        targetId: existing.targetId,
      };
    }
    await disconnectExtensionClient(conversationId);
  }

  const resolved = await resolveServiceWorkerTarget(extensionId);
  if (!resolved.ok || !resolved.target) {
    return {
      connected: false,
      error: resolved.message,
      errorCode: resolved.errorCode,
    };
  }
  const targetId = resolved.target.id;

  const attached = await attachToTarget(targetId);
  if (!attached.ok) {
    return {
      connected: false,
      error: "I could not attach to the Apty Client Service Worker.",
      errorCode: "attach_failed",
    };
  }

  const requests = new Map<string, ExtensionCaptureEntry>();
  let truncated = false;
  const listener = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => {
    if (source.targetId !== targetId) return;
    const p = params as Record<string, any>;
    if (method === "Network.requestWillBeSent") {
      if (
        !requests.has(p.requestId) &&
        requests.size >= MAX_CAPTURED_RESOURCES
      ) {
        const oldestKey = requests.keys().next().value;
        if (oldestKey !== undefined) requests.delete(oldestKey);
        truncated = true;
      }
      requests.set(p.requestId, {
        requestId: p.requestId,
        url: p.request?.url,
        method: p.request?.method,
        timestamp: Date.now(),
      });
    } else if (method === "Network.responseReceived") {
      const req = requests.get(p.requestId);
      if (req) {
        req.status = p.response?.status;
        req.statusText = p.response?.statusText;
        req.mimeType = p.response?.mimeType;
      }
    } else if (method === "Network.loadingFailed") {
      const req = requests.get(p.requestId);
      if (req) {
        req.failed = true;
        req.errorText = p.errorText;
      }
    }
  };

  chromeApi()?.debugger?.onEvent.addListener(listener);
  try {
    await sendCommandToTarget(targetId, "Network.enable", {});
  } catch (error) {
    chromeApi()?.debugger?.onEvent.removeListener(listener);
    await detachFromTarget(targetId);
    return {
      connected: false,
      error: error instanceof Error ? error.message : String(error),
      errorCode: "network_enable_failed",
    };
  }

  sessionsByConversation.set(key, {
    extensionId,
    targetId,
    connectedAt: Date.now(),
    requests,
    get truncated() {
      return truncated;
    },
    listener,
  } as ActiveExtensionSession);

  return { connected: true, extensionId, targetId };
}

export interface DisconnectResult {
  disconnected: boolean;
  error?: string;
}

/** Stop capturing and detach from the conversation's connected extension, if any. */
export async function disconnectExtensionClient(
  conversationId: string | undefined,
): Promise<DisconnectResult> {
  const key = keyFor(conversationId);
  const session = sessionsByConversation.get(key);
  if (!session) {
    return {
      disconnected: false,
      error: "No Apty Client connection is active for this conversation.",
    };
  }
  teardown(key, session);
  try {
    await sendCommandToTarget(session.targetId, "Network.disable", {});
  } catch {
    // Best-effort — still detach.
  }
  await detachFromTarget(session.targetId);
  return { disconnected: true };
}

export type ExtensionConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      extensionId: string;
      targetId: string;
      connectedAt: number;
      requestCount: number;
      truncated: boolean;
    };

export function getExtensionConnectionStatus(
  conversationId: string | undefined,
): ExtensionConnectionStatus {
  const session = sessionsByConversation.get(keyFor(conversationId));
  if (!session) return { connected: false };
  return {
    connected: true,
    extensionId: session.extensionId,
    targetId: session.targetId,
    connectedAt: session.connectedAt,
    requestCount: session.requests.size,
    truncated: session.truncated,
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
 * Match observed requests against a resource query. Supports an exact
 * filename (`segments.json`), a path/URL suffix (`/api/segments.json`), and
 * a substring fragment (`segments`) — see MASTER PROMPT section 6. Ranked
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

export function listObservedResources(conversationId: string | undefined):
  | { connected: false }
  | {
      connected: true;
      extensionId: string;
      resources: Array<
        Pick<
          ExtensionCaptureEntry,
          | "requestId"
          | "url"
          | "method"
          | "status"
          | "mimeType"
          | "failed"
          | "timestamp"
        > & { resourceName: string }
      >;
      truncated: boolean;
    } {
  const session = sessionsByConversation.get(keyFor(conversationId));
  if (!session) return { connected: false };
  const resources = Array.from(session.requests.values()).map((r) => ({
    requestId: r.requestId,
    url: r.url,
    method: r.method,
    status: r.status,
    mimeType: r.mimeType,
    failed: r.failed,
    timestamp: r.timestamp,
    resourceName: resourceNameFor(r.url ?? ""),
  }));
  return {
    connected: true,
    extensionId: session.extensionId,
    resources,
    truncated: session.truncated,
  };
}

// ---------------------------------------------------------------------------
// Response body retrieval
// ---------------------------------------------------------------------------

/** Preview cap for inline chat display — the full (redacted) body is always stored as evidence (see get_investigation_timeline), this just keeps the chat response readable (MASTER PROMPT section 15). */
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

/** Find the observed request matching `resourceQuery` and retrieve its actual response body via Network.getResponseBody. Never fabricates a body — every non-"ok" status is an explicit, structured failure (MASTER PROMPT section 14). */
export async function inspectResource(
  conversationId: string | undefined,
  resourceQuery: string,
): Promise<InspectResourceResult> {
  const session = sessionsByConversation.get(keyFor(conversationId));
  if (!session) {
    return {
      found: false,
      status: "not_connected",
      resourceQuery,
      error:
        "Not connected to an Apty Client Service Worker. Call connect_apty_client with an extension ID first.",
    };
  }

  const all = Array.from(session.requests.values());
  const matches = matchResources(all, resourceQuery);
  if (matches.length === 0) {
    const observedResources = Array.from(
      new Set(all.map((r) => resourceNameFor(r.url ?? ""))),
    ).filter(Boolean);
    return {
      found: false,
      status: "not_observed",
      resourceQuery,
      observedResources,
      error: `I connected to the Apty Client Service Worker, but I did not observe a matching request for: ${resourceQuery}`,
    };
  }

  const best = matches[0];
  if (!best) {
    return {
      found: false,
      status: "not_observed",
      resourceQuery,
      error: `I connected to the Apty Client Service Worker, but I did not observe a matching request for: ${resourceQuery}`,
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
        "I connected successfully but did not observe a response for the requested resource within the capture window. Please try again shortly.",
    };
  }

  let raw: { body: string; base64Encoded: boolean };
  try {
    raw = await sendCommandToTarget<{ body: string; base64Encoded: boolean }>(
      session.targetId,
      "Network.getResponseBody",
      { requestId: best.requestId },
    );
  } catch {
    return {
      found: true,
      status: "body_unavailable",
      resourceQuery,
      request: best,
      error:
        "The request was observed, but Chrome did not provide the response body.",
    };
  }

  const textual = isTextualMime(best.mimeType);
  let text = "";
  let isBinary = !textual;
  if (textual) {
    try {
      text = raw.base64Encoded ? decodeBase64Utf8(raw.body) : raw.body;
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
      extensionId: session.extensionId,
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
  return sessionsByConversation.size;
}

/** Test-only: simulate the forced-cleanup path a real chrome.debugger.onDetach event would trigger. */
export function __simulateForcedDetachForTarget(targetId: string): void {
  forceCleanupForTarget(targetId);
}

/** Test-only: simulate the forced-cleanup path a real chrome.management.onUninstalled/onDisabled event would trigger. */
export function __simulateExtensionRemoved(extensionId: string): void {
  forceCleanupForExtension(extensionId);
}
