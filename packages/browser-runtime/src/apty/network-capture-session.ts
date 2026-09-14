/**
 * Investigation-aware network capture session.
 *
 * `get_network_diagnostics` (devtools.ts) only sees traffic that occurs
 * during a short, fixed capture window (500ms-15s) — it has to be called
 * right as the user reproduces the issue, and any multi-step reproduction
 * (navigate, click through a few screens, wait for an async workflow step)
 * easily runs longer than that. This module implements the
 * "start capture → investigation performs actions → stop capture →
 * requests correlated to investigation" flow instead: `startNetworkCapture`
 * attaches the debugger and begins accumulating requests in the
 * background without blocking, `stopNetworkCapture` (called whenever the
 * model decides enough time/turns have passed) returns everything that was
 * seen in between.
 *
 * One capture session per conversation, mirroring evidence-store.ts and
 * investigation-session.ts's per-conversation isolation — and, like both of
 * those, in-memory only: a capture does not survive a service-worker
 * restart. If a conversation's active investigation exists at start time,
 * its id is attached to the session so evidence recorded at stop time is
 * traceable back to the investigation that triggered the capture.
 */
import { generateId } from "@aipexstudio/aipex-core";
import { CdpCommander } from "../automation/cdp-commander.js";
import { debuggerManager } from "../automation/debugger-manager.js";
import { recordEvidence } from "./evidence-store.js";
import { getInvestigation } from "./investigation-session.js";
import { redactHeaders } from "./redact.js";

export interface CapturedNetworkRequest {
  requestId: string;
  url: string;
  method: string;
  /** CDP resource type (e.g. "XHR", "Fetch", "Document", "Script"). */
  resourceType?: string;
  /** CDP initiator type (e.g. "script", "parser"), when available — not the full initiator (stack traces are noisy and not redacted). */
  initiatorType?: string;
  requestHeaders?: Record<string, string>;
  status?: number;
  statusText?: string;
  responseHeaders?: Record<string, string>;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  timestamp: number;
}

export type NetworkCaptureStatus = "capturing" | "stopped";

export interface NetworkCaptureSession {
  id: string;
  conversationId: string;
  tabId: number;
  /** The investigation active in this conversation when the capture started, if any (see investigation-session.ts). */
  investigationId?: string;
  startedAt: number;
  stoppedAt?: number;
  status: NetworkCaptureStatus;
  requestCount: number;
}

interface ActiveCapture {
  session: NetworkCaptureSession;
  requests: Map<string, CapturedNetworkRequest>;
  listener: (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => void;
  heartbeat: ReturnType<typeof setInterval>;
}

const UNSCOPED_KEY = "__unscoped__";

function keyFor(conversationId: string | undefined): string {
  return conversationId && conversationId !== "pending"
    ? conversationId
    : UNSCOPED_KEY;
}

const activeByConversation = new Map<string, ActiveCapture>();

/**
 * `debugger-manager.ts` auto-detaches an idle tab after 30s. A capture can
 * legitimately run far longer than that while the user reproduces an issue,
 * so re-assert the attachment well inside that window — `safeAttachDebugger`
 * is a no-op against an already-attached tab beyond resetting its idle
 * timer, so this never disrupts the in-flight capture.
 */
const HEARTBEAT_MS = 15000;

function toPublicSession(active: ActiveCapture): NetworkCaptureSession {
  return { ...active.session, requestCount: active.requests.size };
}

export interface StartCaptureResult {
  started: boolean;
  session?: NetworkCaptureSession;
  error?: string;
}

/** Begin a network capture for `tabId`, scoped to `conversationId`. Returns immediately — it does not wait for traffic. */
export async function startNetworkCapture(
  conversationId: string | undefined,
  tabId: number,
): Promise<StartCaptureResult> {
  const key = keyFor(conversationId);
  const existing = activeByConversation.get(key);
  if (existing) {
    return {
      started: false,
      session: toPublicSession(existing),
      error:
        "A network capture is already running for this conversation. Call stop_network_capture first.",
    };
  }

  const attached = await debuggerManager.safeAttachDebugger(tabId);
  if (!attached) {
    return { started: false, error: "Failed to attach debugger to the tab" };
  }

  const requests = new Map<string, CapturedNetworkRequest>();
  const listener = (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => {
    if (source.tabId !== tabId) return;
    const p = params as Record<string, any>;
    if (method === "Network.requestWillBeSent") {
      requests.set(p.requestId, {
        requestId: p.requestId,
        url: p.request?.url,
        method: p.request?.method,
        resourceType: p.type,
        initiatorType: p.initiator?.type,
        requestHeaders: redactHeaders(p.request?.headers),
        timestamp: Date.now(),
      });
    } else if (method === "Network.responseReceived") {
      const req = requests.get(p.requestId);
      if (req) {
        req.status = p.response?.status;
        req.statusText = p.response?.statusText;
        req.responseHeaders = redactHeaders(p.response?.headers);
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

  chrome.debugger.onEvent.addListener(listener);
  try {
    await new CdpCommander(tabId).sendCommand("Network.enable", {});
  } catch (error) {
    chrome.debugger.onEvent.removeListener(listener);
    await debuggerManager.safeDetachDebugger(tabId, true);
    return {
      started: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const heartbeat = setInterval(() => {
    debuggerManager.safeAttachDebugger(tabId).catch(() => {});
  }, HEARTBEAT_MS);

  const session: NetworkCaptureSession = {
    id: generateId(),
    conversationId: key,
    tabId,
    investigationId: getInvestigation(conversationId)?.id,
    startedAt: Date.now(),
    status: "capturing",
    requestCount: 0,
  };

  const active: ActiveCapture = { session, requests, listener, heartbeat };
  activeByConversation.set(key, active);
  return { started: true, session: toPublicSession(active) };
}

export interface StopCaptureResult {
  stopped: boolean;
  session?: NetworkCaptureSession;
  requests?: CapturedNetworkRequest[];
  error?: string;
}

/** Stop the conversation's active capture, detach the debugger, and return everything captured. Failed/4xx/5xx requests are recorded as evidence, tagged with the investigation id captured at start time. */
export async function stopNetworkCapture(
  conversationId: string | undefined,
  options: { onlyErrors?: boolean } = {},
): Promise<StopCaptureResult> {
  const key = keyFor(conversationId);
  const active = activeByConversation.get(key);
  if (!active) {
    return {
      stopped: false,
      error: "No network capture is running for this conversation.",
    };
  }
  activeByConversation.delete(key);

  clearInterval(active.heartbeat);
  chrome.debugger.onEvent.removeListener(active.listener);

  try {
    await new CdpCommander(active.session.tabId).sendCommand(
      "Network.disable",
      {},
    );
  } catch {
    // Best-effort — still detach and return whatever was captured.
  }
  await debuggerManager.safeDetachDebugger(active.session.tabId, true);

  const all = Array.from(active.requests.values());
  for (const request of all) {
    const isFailure =
      request.failed || (request.status !== undefined && request.status >= 400);
    if (!isFailure) continue;
    recordEvidence({
      conversationId,
      source: "network",
      type: request.failed ? "network-failed" : "network-http-error",
      timestamp: request.timestamp,
      tabId: active.session.tabId,
      url: request.url,
      requestId: request.requestId,
      correlationId: active.session.investigationId,
      data: request,
    });
  }

  const list = options.onlyErrors
    ? all.filter((r) => r.failed || (r.status !== undefined && r.status >= 400))
    : all;

  const stoppedSession: NetworkCaptureSession = {
    ...active.session,
    stoppedAt: Date.now(),
    status: "stopped",
    requestCount: all.length,
  };

  return { stopped: true, session: stoppedSession, requests: list };
}

/** The conversation's in-progress capture, if any — for checking progress without stopping it. */
export function getNetworkCaptureStatus(
  conversationId: string | undefined,
): NetworkCaptureSession | undefined {
  const active = activeByConversation.get(keyFor(conversationId));
  return active ? toPublicSession(active) : undefined;
}

/** Test/debug helper: how many conversations currently have a capture running. */
export function getActiveCaptureCount(): number {
  return activeByConversation.size;
}
