/**
 * Ask Dapty capture, injected mode: the Apty Widget runs as a page script
 * and calls the ai-service chat endpoint with the page's own `fetch`, so the
 * tab's network carries the call. Two sources see it:
 *
 * - Passive: a `chrome.webRequest` listener records each chat POST's request
 *   body (and its status once it completes). Always on; it never sees the
 *   response body.
 * - On demand: `recordDaptyChat` attaches `chrome.debugger` to the tab for a
 *   bounded time and records the chat POSTs with both bodies, plus the
 *   Widget's stored-chat GETs (`/widget-chat/*.json`).
 *
 * In extension mode the call runs in the Apty Client extension's service
 * worker, which neither source can see (Chrome refuses both); that path goes
 * through the Client contract instead (`readWidgetChat`).
 *
 * Chat text is the end user's own content: it is kept only in memory and in
 * `chrome.storage.session`, at most `MAX_CALLS_PER_TAB` calls per tab and
 * `MAX_BODY_CHARS` per body, dropped when the tab closes, never logged and
 * never redacted here (the Ask Dapty check redacts before showing anything).
 * Bodies of URLs on the user's body deny list are not kept.
 */
import { CdpCommander } from "../automation/cdp-commander.js";
import { debuggerManager } from "../automation/debugger-manager.js";
import { isOwnExtensionPage } from "../runtime/trusted-sender.js";
import { loadBodyDenyList } from "./extension-network-inspector.js";
import { peekTabRequests } from "./network-capture-session.js";
import { decodeBase64Utf8, matchingDenyEntry } from "./resource-body-utils.js";

/** @internal Used by the Ask Dapty check. */
export interface RawDaptyCall {
  source: "page" | "client" | "har";
  kind: "chat" | "stored-chat" | "chat-list";
  /** The full URL; the Ask Dapty check strips it before anything is shown. */
  url: string;
  method: string;
  /** The HTTP status, when a response came back. */
  status?: number;
  /** A network error or a blocked call (status 0). */
  failed?: boolean;
  errorText?: string;
  /** The POST's UTF-8 JSON text, when seen. */
  requestBody?: string;
  /** The response's UTF-8 text, when seen. */
  responseBody?: string;
  /** Milliseconds since the epoch. */
  timestamp: number;
}

/** @internal */
export const MAX_CALLS_PER_TAB = 20;
/** @internal */
export const MAX_BODY_CHARS = 1_000_000;
const DEFAULT_RECORDING_MS = 120_000;
const MAX_RECORDING_MS = 600_000;
/** A webRequest record and a debugger record of one call start this close together. */
const SAME_CALL_WINDOW_MS = 5_000;
const HEARTBEAT_MS = 15_000;

/** @internal */
export const DAPTY_PAGE_CALLS_MESSAGE = "apty-agent:dapty-page-calls";
const DAPTY_RECORD_MESSAGE = "apty-agent:dapty-record";
const DAPTY_STOP_RECORDING_MESSAGE = "apty-agent:dapty-stop-recording";
const STORAGE_PREFIX = "apty-dapty-page-calls:";
/** @internal */
export const RECORDING_KEEPALIVE_ALARM_NAME = "apty-dapty-recording-keepalive";
const RECORDING_KEEPALIVE_INTERVAL_MINUTES = 0.4;

const CHAT_PATH =
  /\/ai-service\/api\/v1\/ai\/[^/]+\/widget\/chat(?:\/stream)?$/;
const WEB_REQUEST_URLS = ["*://*/*ai-service/api/v1/ai/*"];

type Via = "webRequest" | "debugger";

interface StoredCall {
  /** The webRequest or CDP request id, prefixed by its source. */
  id: string;
  via: Via;
  /** Arrival order, for calls that start in the same millisecond. */
  seq: number;
  call: RawDaptyCall;
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** @internal */
export function classifyDaptyUrl(
  url: string,
  method: string,
): RawDaptyCall["kind"] | null {
  const path = pathOf(url);
  const verb = method.toUpperCase();
  if (verb === "POST" && CHAT_PATH.test(path)) return "chat";
  if (
    verb === "GET" &&
    path.includes("/widget-chat/") &&
    path.endsWith(".json")
  ) {
    return path.endsWith("/chat-list.json") ? "chat-list" : "stored-chat";
  }
  return null;
}

function bounded(body: string | undefined): string | undefined {
  return body !== undefined && body.length <= MAX_BODY_CHARS ? body : undefined;
}

const callsByTab = new Map<number, StoredCall[]>();
let nextSeq = 0;

function byArrival(a: StoredCall, b: StoredCall): number {
  return a.call.timestamp - b.call.timestamp || a.seq - b.seq;
}
const loadedTabs = new Set<number>();
let queue: Promise<unknown> = Promise.resolve();

/** Runs store changes one at a time, so a completion never lands before its request. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

function getChromeApi(): typeof chrome | undefined {
  return (globalThis as { chrome?: typeof chrome }).chrome;
}

async function loadTab(tabId: number): Promise<StoredCall[]> {
  if (!loadedTabs.has(tabId)) {
    loadedTabs.add(tabId);
    const key = `${STORAGE_PREFIX}${tabId}`;
    const stored = await getChromeApi()
      ?.storage?.session?.get(key)
      .catch(() => undefined);
    const saved = stored?.[key];
    if (Array.isArray(saved)) {
      const fresh = callsByTab.get(tabId) ?? [];
      const known = new Set(fresh.map((entry) => entry.id));
      callsByTab.set(tabId, [
        ...(saved as StoredCall[]).filter((entry) => !known.has(entry.id)),
        ...fresh,
      ]);
    }
  }
  const calls = callsByTab.get(tabId) ?? [];
  callsByTab.set(tabId, calls);
  return calls;
}

async function saveTab(tabId: number): Promise<void> {
  const calls = callsByTab.get(tabId) ?? [];
  const trimmed = (["webRequest", "debugger"] as const).flatMap((via) =>
    calls.filter((entry) => entry.via === via).slice(-MAX_CALLS_PER_TAB),
  );
  trimmed.sort(byArrival);
  callsByTab.set(tabId, trimmed);
  await getChromeApi()
    ?.storage?.session?.set({ [`${STORAGE_PREFIX}${tabId}`]: trimmed })
    .catch(() => undefined);
}

function upsert(
  tabId: number,
  id: string,
  via: Via,
  update: (call: RawDaptyCall | undefined) => RawDaptyCall | undefined,
  seq?: number,
): Promise<void> {
  return serialized(async () => {
    const calls = await loadTab(tabId);
    const index = calls.findIndex((entry) => entry.id === id);
    const next = update(index === -1 ? undefined : calls[index]?.call);
    if (!next) return;
    const existing = calls[index];
    if (existing) existing.call = next;
    else calls.push({ id, via, seq: seq ?? nextSeq++, call: next });
    await saveTab(tabId);
  });
}

const pendingById = new Map<string, Promise<void>>();

/** Runs one request's event handlers in arrival order, even when an earlier one awaits. */
function inOrder(id: string, task: () => Promise<void>): void {
  const next = (pendingById.get(id) ?? Promise.resolve())
    .then(task)
    .catch(() => undefined);
  pendingById.set(id, next);
  void next.then(() => {
    if (pendingById.get(id) === next) pendingById.delete(id);
  });
}

function forgetTab(tabId: number): Promise<void> {
  return serialized(async () => {
    callsByTab.delete(tabId);
    loadedTabs.delete(tabId);
    await getChromeApi()
      ?.storage?.session?.remove(`${STORAGE_PREFIX}${tabId}`)
      .catch(() => undefined);
  });
}

async function isBodyDenied(url: string): Promise<boolean> {
  const denyList = await loadBodyDenyList().catch(() => []);
  return matchingDenyEntry(url, denyList) !== null;
}

function decodeRaw(
  raw: chrome.webRequest.UploadData[] | undefined,
): string | undefined {
  if (!raw?.length) return undefined;
  const parts = raw.flatMap((part) =>
    part.bytes ? [new Uint8Array(part.bytes)] : [],
  );
  if (parts.length === 0) return undefined;
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(all);
}

function onBeforeRequest(
  details: chrome.webRequest.OnBeforeRequestDetails,
): undefined {
  if (details.tabId < 0) return;
  const kind = classifyDaptyUrl(details.url, details.method);
  if (kind !== "chat") return;
  const text = decodeRaw(details.requestBody?.raw);
  const id = `wr:${details.requestId}`;
  const seq = nextSeq++;
  inOrder(id, async () => {
    const denied = await isBodyDenied(details.url);
    await upsert(
      details.tabId,
      id,
      "webRequest",
      () => ({
        source: "page",
        kind,
        url: details.url,
        method: details.method.toUpperCase(),
        ...(denied ? {} : { requestBody: bounded(text) }),
        timestamp: Math.round(details.timeStamp ?? Date.now()),
      }),
      seq,
    );
  });
  return;
}

function updatePassive(
  details: chrome.webRequest.WebRequestDetails,
  change: Partial<RawDaptyCall>,
): void {
  if (details.tabId < 0) return;
  if (classifyDaptyUrl(details.url, details.method) !== "chat") return;
  const id = `wr:${details.requestId}`;
  inOrder(id, () =>
    upsert(details.tabId, id, "webRequest", (existing) =>
      existing ? { ...existing, ...change } : undefined,
    ),
  );
}

function onCompleted(details: chrome.webRequest.OnCompletedDetails): void {
  updatePassive(details, {
    status: details.statusCode,
    ...(details.statusCode === 0 ? { failed: true } : {}),
  });
}

function onErrorOccurred(
  details: chrome.webRequest.OnErrorOccurredDetails,
): void {
  updatePassive(details, { failed: true, errorText: details.error });
}

interface Recording {
  tabId: number;
  until: number;
  listener: (
    source: chrome.debugger.Debuggee,
    method: string,
    params?: object,
  ) => void;
  heartbeat: ReturnType<typeof setInterval>;
  timer: ReturnType<typeof setTimeout>;
}

const recordings = new Map<number, Recording>();

interface DaptyCdpParams {
  requestId: string;
  hasPostData?: boolean;
  errorText?: string;
  request?: {
    url?: string;
    method?: string;
    postData?: string;
    hasPostData?: boolean;
  };
  response?: { status?: number };
}

async function cdpBody(
  tabId: number,
  command: "Network.getRequestPostData" | "Network.getResponseBody",
  requestId: string,
): Promise<string | undefined> {
  try {
    const result = await new CdpCommander(tabId).sendCommand<{
      postData?: string;
      body?: string;
      base64Encoded?: boolean;
    }>(command, { requestId });
    const text = result?.postData ?? result?.body;
    if (text === undefined) return undefined;
    return result?.base64Encoded ? decodeBase64Utf8(text) : text;
  } catch {
    return undefined;
  }
}

function recorderFor(tabId: number): Recording["listener"] {
  const seen = new Set<string>();
  return (source, method, params) => {
    if (source.tabId !== tabId) return;
    const p = (params ?? {}) as DaptyCdpParams;
    const id = `cdp:${p.requestId}`;
    if (method === "Network.requestWillBeSent") {
      const url = String(p.request?.url ?? "");
      const verb = String(p.request?.method ?? "GET").toUpperCase();
      const kind = classifyDaptyUrl(url, verb);
      if (!kind) return;
      seen.add(p.requestId);
      const inline = p.request?.postData;
      const hasPostData = p.request?.hasPostData ?? p.hasPostData;
      const timestamp = Date.now();
      const seq = nextSeq++;
      inOrder(id, async () => {
        const denied = await isBodyDenied(url);
        const posted =
          kind === "chat" && !denied
            ? (inline ??
              (hasPostData
                ? await cdpBody(
                    tabId,
                    "Network.getRequestPostData",
                    p.requestId,
                  )
                : undefined))
            : undefined;
        await upsert(
          tabId,
          id,
          "debugger",
          () => ({
            source: "page",
            kind,
            url,
            method: verb,
            ...(posted !== undefined ? { requestBody: bounded(posted) } : {}),
            timestamp,
          }),
          seq,
        );
      });
      return;
    }
    if (!seen.has(p.requestId)) return;
    const change = (update: (call: RawDaptyCall) => Promise<RawDaptyCall>) =>
      inOrder(id, async () => {
        const calls = await serialized(() => loadTab(tabId));
        const current = calls.find((entry) => entry.id === id)?.call;
        if (!current) return;
        const next = await update(current);
        await upsert(tabId, id, "debugger", (existing) =>
          existing ? { ...existing, ...next } : undefined,
        );
      });
    if (method === "Network.responseReceived") {
      change(async (call) => ({ ...call, status: p.response?.status }));
    } else if (method === "Network.loadingFailed") {
      seen.delete(p.requestId);
      change(async (call) => ({
        ...call,
        failed: true,
        errorText: p.errorText,
      }));
    } else if (method === "Network.loadingFinished") {
      seen.delete(p.requestId);
      change(async (call) => {
        if (await isBodyDenied(call.url)) return call;
        const body = await cdpBody(
          tabId,
          "Network.getResponseBody",
          p.requestId,
        );
        return body === undefined
          ? call
          : { ...call, responseBody: bounded(body) };
      });
    }
  };
}

function handleKeepaliveAlarm(alarm: { name: string }): void {
  if (alarm.name !== RECORDING_KEEPALIVE_ALARM_NAME) return;
  for (const recording of recordings.values()) {
    debuggerManager.safeAttachDebugger(recording.tabId).catch(() => {});
  }
}

function endRecording(recording: Recording): void {
  recordings.delete(recording.tabId);
  clearInterval(recording.heartbeat);
  clearTimeout(recording.timer);
  getChromeApi()?.debugger?.onEvent?.removeListener(recording.listener);
  if (recordings.size === 0) {
    getChromeApi()?.alarms?.clear(RECORDING_KEEPALIVE_ALARM_NAME);
  }
}

let started = false;

/**
 * Registers the passive webRequest capture and the per-tab cleanup, once.
 * Called from the background service worker at startup.
 */
export function startDaptyPageCapture(): void {
  const chromeApi = getChromeApi();
  if (started || !chromeApi) return;
  started = true;
  const filter = { urls: WEB_REQUEST_URLS };
  chromeApi.webRequest?.onBeforeRequest.addListener(onBeforeRequest, filter, [
    "requestBody",
  ]);
  chromeApi.webRequest?.onCompleted.addListener(onCompleted, filter);
  chromeApi.webRequest?.onErrorOccurred.addListener(onErrorOccurred, filter);
  chromeApi.tabs?.onRemoved?.addListener((tabId) => {
    const recording = recordings.get(tabId);
    if (recording) endRecording(recording);
    void forgetTab(tabId);
  });
  chromeApi.debugger?.onDetach?.addListener((source) => {
    const recording =
      source.tabId === undefined ? undefined : recordings.get(source.tabId);
    if (recording) endRecording(recording);
  });
  chromeApi.alarms?.onAlarm?.addListener(handleKeepaliveAlarm);
}

function inServiceWorker(): boolean {
  return "ServiceWorkerGlobalScope" in globalThis;
}

async function askWorker<T>(
  message: Record<string, unknown>,
): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T | undefined;
  } catch {
    return undefined;
  }
}

/** @internal Used by the Ask Dapty check. */
export type DaptyRecordingResult =
  | { ok: true; until: number }
  | {
      ok: false;
      reason: "attach-failed" | "network-enable-failed" | "unreachable";
    };

/**
 * Attach `chrome.debugger` to the tab for at most `maxMs` and record the
 * Widget's chat POSTs and stored-chat GETs with their bodies. A second call
 * while recording extends the window.
 * @internal Used by the Ask Dapty check.
 */
export async function recordDaptyChat(
  tabId: number,
  options: { maxMs?: number } = {},
): Promise<DaptyRecordingResult> {
  if (!inServiceWorker()) {
    return (
      (await askWorker<DaptyRecordingResult>({
        type: DAPTY_RECORD_MESSAGE,
        tabId,
        maxMs: options.maxMs,
      })) ?? { ok: false, reason: "unreachable" }
    );
  }
  startDaptyPageCapture();
  const maxMs = Math.min(
    Math.max(options.maxMs ?? DEFAULT_RECORDING_MS, 1_000),
    MAX_RECORDING_MS,
  );
  const until = Date.now() + maxMs;
  const existing = recordings.get(tabId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.until = until;
    existing.timer = setTimeout(() => void stopDaptyRecording(tabId), maxMs);
    return { ok: true, until };
  }

  if (!(await debuggerManager.safeAttachDebugger(tabId))) {
    return { ok: false, reason: "attach-failed" };
  }
  const listener = recorderFor(tabId);
  chrome.debugger.onEvent.addListener(listener);
  try {
    await new CdpCommander(tabId).sendCommand("Network.enable", {});
  } catch {
    chrome.debugger.onEvent.removeListener(listener);
    if (peekTabRequests(tabId, 0) === null) {
      await debuggerManager.safeDetachDebugger(tabId, true);
    }
    return { ok: false, reason: "network-enable-failed" };
  }
  const recording: Recording = {
    tabId,
    until,
    listener,
    heartbeat: setInterval(() => {
      debuggerManager.safeAttachDebugger(tabId).catch(() => {});
    }, HEARTBEAT_MS),
    timer: setTimeout(() => void stopDaptyRecording(tabId), maxMs),
  };
  recordings.set(tabId, recording);
  if (recordings.size === 1) {
    chrome.alarms?.create(RECORDING_KEEPALIVE_ALARM_NAME, {
      periodInMinutes: RECORDING_KEEPALIVE_INTERVAL_MINUTES,
    });
  }
  return { ok: true, until };
}

/**
 * Stop recording the tab and detach the debugger, unless a network capture
 * still uses it.
 * @internal Used by the Ask Dapty check.
 */
export async function stopDaptyRecording(tabId: number): Promise<void> {
  if (!inServiceWorker()) {
    await askWorker({ type: DAPTY_STOP_RECORDING_MESSAGE, tabId });
    return;
  }
  const recording = recordings.get(tabId);
  if (!recording) return;
  endRecording(recording);
  if (peekTabRequests(tabId, 0) !== null) return;
  try {
    await new CdpCommander(tabId).sendCommand("Network.disable", {});
  } catch {
    // Best effort: detach either way.
  }
  await debuggerManager.safeDetachDebugger(tabId, true);
}

function isSameCall(passive: RawDaptyCall, recorded: RawDaptyCall): boolean {
  return (
    passive.method === recorded.method &&
    passive.url === recorded.url &&
    Math.abs(passive.timestamp - recorded.timestamp) <= SAME_CALL_WINDOW_MS &&
    (passive.requestBody === undefined ||
      recorded.requestBody === undefined ||
      passive.requestBody === recorded.requestBody)
  );
}

/** Both sources as one list, newest last: a call both saw appears once, as the debugger's richer record. */
function merge(calls: readonly StoredCall[]): RawDaptyCall[] {
  const recorded = calls.filter((entry) => entry.via === "debugger");
  const claimed = new Set<StoredCall>();
  const kept = calls.filter((entry) => {
    if (entry.via === "debugger") return true;
    const twin = recorded.find(
      (other) => !claimed.has(other) && isSameCall(entry.call, other.call),
    );
    if (!twin) return true;
    claimed.add(twin);
    if (
      twin.call.requestBody === undefined &&
      entry.call.requestBody !== undefined
    ) {
      twin.call = { ...twin.call, requestBody: entry.call.requestBody };
    }
    return false;
  });
  return kept
    .sort(byArrival)
    .map((entry) => entry.call)
    .slice(-MAX_CALLS_PER_TAB);
}

/**
 * The Ask Dapty calls the tab's network carried, newest last. Outside the
 * service worker it asks the worker, which holds them.
 * @internal Used by the Ask Dapty check.
 */
export async function getDaptyPageCalls(
  tabId: number,
): Promise<RawDaptyCall[]> {
  if (!inServiceWorker()) {
    const answer = await askWorker<{ calls?: RawDaptyCall[] }>({
      type: DAPTY_PAGE_CALLS_MESSAGE,
      tabId,
    });
    return Array.isArray(answer?.calls) ? answer.calls : [];
  }
  const calls = await serialized(() => loadTab(tabId));
  return merge(calls.map((entry) => ({ ...entry, call: { ...entry.call } })));
}

/**
 * The worker's side of the messages the side panel sends: answers this
 * extension's own pages only. Returns whether it will answer.
 */
export function handleDaptyCaptureMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
): boolean {
  const { type, tabId, maxMs } = (message ?? {}) as {
    type?: unknown;
    tabId?: unknown;
    maxMs?: unknown;
  };
  if (
    type !== DAPTY_PAGE_CALLS_MESSAGE &&
    type !== DAPTY_RECORD_MESSAGE &&
    type !== DAPTY_STOP_RECORDING_MESSAGE
  ) {
    return false;
  }
  if (!isOwnExtensionPage(sender) || typeof tabId !== "number") {
    sendResponse(undefined);
    return false;
  }
  const work =
    type === DAPTY_PAGE_CALLS_MESSAGE
      ? getDaptyPageCalls(tabId).then((calls) => ({ calls }))
      : type === DAPTY_RECORD_MESSAGE
        ? recordDaptyChat(tabId, {
            maxMs: typeof maxMs === "number" ? maxMs : undefined,
          })
        : stopDaptyRecording(tabId).then(() => ({ ok: true }));
  work.then(sendResponse, () => sendResponse(undefined));
  return true;
}

/**
 * Test-only: forget every in-memory call, recording and registration.
 * @internal
 */
export function __resetDaptyPageCapture(): void {
  for (const recording of [...recordings.values()]) endRecording(recording);
  callsByTab.clear();
  loadedTabs.clear();
  pendingById.clear();
  nextSeq = 0;
  started = false;
  queue = Promise.resolve();
}
