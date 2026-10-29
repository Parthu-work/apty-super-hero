/**
 * REFERENCE IMPLEMENTATION — for the Apty Widget team, not part of this build
 * ============================================================================
 *
 * This file is documentation, not compiled code. It lives outside every
 * package's `src/` directory specifically so it is never picked up by any
 * `tsconfig.json` `include` glob in this repo (`packages/browser-runtime`
 * uses `"include": ["src/**\/*"]`, which does not reach `docs/`).
 *
 * WHAT THIS IS
 * ------------
 * A complete, adaptable reference for the producer side of Option A
 * (live Apty service-worker diagnostics, see docs/development/PROJECT_PROGRESS.md /
 * ARCHITECTURE.md): the code that should live inside the Apty Widget's own
 * Manifest V3 service worker so the Apty Agent can request its status, its
 * recent logs, the network calls it made and their response bodies. The
 * Agent's consumer side already exists and matches this exact contract — see
 * packages/browser-runtime/src/apty/service-worker-diagnostics.ts, whose zod
 * schemas a contract test in this repo checks this file's answers against
 * (packages/browser-runtime/src/apty/widget-reference-contract.test.ts).
 *
 * WHAT THE WIDGET TEAM MUST CHANGE
 * --------------------------------
 * 1. The Widget's manifest.json lists BOTH Agent IDs (docs/integrations/apty/
 *    README.md, "Extension IDs"):
 *      "externally_connectable": { "ids": ["bpiondflhhdplemamgggcdajclmoeple",
 *                                          "<the Web Store ID, once assigned>"] }
 *    and DEBUG_AGENT_EXTENSION_IDS below holds the same two.
 * 2. Paste this file's code into the Widget's service worker (or import it
 *    from there), at the top level, so the onMessageExternal listener is
 *    registered on every service-worker start. If the service worker already
 *    has an onMessageExternal listener (the Apty Client does), leave out the
 *    listener at the bottom of this file and end the existing one with
 *    `return handleNetworkMessage(message, sendResponse)`.
 * 3. Route the Widget's own requests through `observedFetch` instead of
 *    `fetch`. Only requests made through it are recorded; nothing else is
 *    intercepted.
 * 4. If the Widget makes a request such as segments.json from a content
 *    script rather than from the service worker, this service worker never
 *    sees it, and observedFetch must run in the content script with a relay
 *    (chrome.runtime.sendMessage to this worker) recording the result here.
 *    We do not know which context makes these calls; check before relying on
 *    this.
 *
 * WHY THIS CAN'T JUST BE BUILT INTO THIS REPO
 * --------------------------------------------
 * Chrome does not allow one extension to read another's private
 * service-worker memory. The only way the debugging agent can see Apty's
 * service-worker logs is if Apty's own service worker actively exports
 * them, from Apty's own codebase, running as Apty's own extension. This
 * file is the specification + implementation for that side; adapt the
 * paths/build tooling to Apty Widget's actual project.
 *
 * DESIGN DECISIONS (see docs/development/PROJECT_PROGRESS.md / DECISIONS.md for the parallel
 * reasoning on the consumer side)
 * ------------------------------------------------------------------------
 * 1. Persist to chrome.storage.local, not just an in-memory array — MV3
 *    service workers are terminated after ~30s of inactivity and restarted
 *    on demand. An in-memory-only buffer loses everything on every
 *    restart, which happens constantly. This is the single most important
 *    design point in this file; skipping it is the most common way a "it
 *    works in my quick test" implementation turns out not to actually work
 *    in practice.
 * 2. Debounce/batch storage writes — writing to chrome.storage.local on
 *    every single console call is wasteful and can hit Chrome's storage
 *    write-rate limits under log-heavy conditions. This buffers in memory
 *    and flushes at most once per FLUSH_INTERVAL_MS, plus immediately
 *    before the service worker is likely to be suspended
 *    (chrome.runtime.onSuspend).
 * 3. Bounded ring buffer, MAX_ENTRIES = 1000 — chosen as a reasonable
 *    balance between "enough history to diagnose a recent issue" and
 *    "small enough that chrome.storage.local writes stay fast and the
 *    diagnostic response stays small." Adjust if Apty's actual log volume
 *    or debugging needs call for a different number — there's nothing
 *    magic about 1000, and the consuming side
 *    (service-worker-diagnostics.ts) independently caps what it will
 *    accept at 2000 entries regardless of what this buffer's limit is set
 *    to, as a defensive ceiling against a misbehaving/compromised producer.
 * 4. Safe serialization, not `args.map(String)` — `String(x)` on a
 *    circular object throws in some engines and produces useless
 *    "[object Object]" in others. safeStringifyArg below handles circular
 *    references, Error objects (message + stack, not the whole object
 *    graph), and depth-bounds nested structures.
 * 5. Sender validation — only responds to the configured Agent extension
 *    IDs. There is no wildcard path. A request from any other sender.id is
 *    ignored (no response sent), not merely "logged and allowed."
 * 6. Network calls are kept in chrome.storage.session, never in
 *    chrome.storage.local: they survive a service-worker restart but are
 *    never written to disk and are gone when the browser closes (and when
 *    the Client extension is reloaded). At most MAX_NETWORK_ENTRIES calls
 *    are kept. Bodies are kept per RESOURCE (method + URL without its
 *    query string, so the cache-buster `?timestamp=...` does not make
 *    every call a new resource): the body of the latest successful call
 *    and, separately, of the latest failed call (status >= 400) per
 *    resource, so a later success does not erase the error body and the
 *    other way round. All kept bodies together stay under
 *    MAX_KEPT_BODY_CHARS; over it, the oldest resources' successful bodies
 *    go first and failed bodies last. A response body over 200,000
 *    characters (MAX_BODY_CHARS, the Agent's own limit) is not served; the
 *    Agent hears found: false, reason: "too-large". Non-text bodies are
 *    kept base64-encoded. The state is written once the calls pause for
 *    SAVE_DEBOUNCE_MS (and on onSuspend), not on every call. A write that
 *    fails (quota) is counted and reported as `saveFailures` in the list
 *    answer: the in-memory state still serves, but a service-worker restart
 *    then loads the last state that was saved.
 * 7. observedFetch never slows or changes the Widget's own fetch: it
 *    returns the Response as soon as fetch does, reads the body afterwards
 *    from a clone, stopping at MAX_BODY_CHARS, and swallows any recording
 *    error. A relative URL is recorded as fetch resolves it in a service
 *    worker, against the worker's own location. This assumes the code runs
 *    in the Widget's service worker (see "WHAT THE WIDGET TEAM MUST
 *    CHANGE", item 4).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * -----------------------------------
 * - Redact sensitive values before storing/returning them. Apty's own log
 *   call sites are the right place to avoid logging secrets in the first
 *   place; the debugging agent's consumer side (redact.ts) also redacts
 *   anything that slips through as defense in depth, but don't rely on
 *   that as the only safeguard — avoid logging tokens/passwords/cookies
 *   from this service worker at all.
 * - Send logs or recorded calls anywhere off the Widget's own extension.
 *   This file makes no network calls of its own (observedFetch only makes
 *   the request the Widget asked for); this is a local
 *   (extension-to-extension message-passing) mechanism only.
 *
 * The message names are the legacy `apty-debug-agent:*` ones the Agent
 * reads today; moving to the v1 contract in packages/apty-debug-contract is
 * separate work.
 */

// ---------------------------------------------------------------------------
// Config — the Agent's two extension IDs (README "Extension IDs"). Fill in
// the Web Store ID once the first upload assigns it. Never a wildcard.
// ---------------------------------------------------------------------------
export const DEBUG_AGENT_EXTENSION_IDS: readonly string[] = [
  "bpiondflhhdplemamgggcdajclmoeple",
  "<the Agent's Chrome Web Store ID, once assigned>",
];

const STORAGE_KEY = "apty_sw_log_buffer";
const MAX_ENTRIES = 1000;
const FLUSH_INTERVAL_MS = 5000;
// Whether to wrap console.log/warn/error to fill the log buffer. A Widget
// that only wants network recording can set this to false.
const CAPTURE_CONSOLE = true;

type LogLevel = "debug" | "log" | "info" | "warn" | "error";

// Matches the AptyLog type already defined in
// packages/browser-runtime/src/apty/types.ts — keep these in sync rather
// than inventing a parallel shape.
interface AptyLogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Safe argument serialization
// ---------------------------------------------------------------------------

const MAX_STRING_LENGTH = 2000;
const MAX_DEPTH = 4;

function safeStringifyValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const t = typeof value;
  if (t === "string") return value as string;
  if (t === "number" || t === "boolean" || t === "bigint") return String(value);
  if (t === "function")
    return `[Function: ${(value as { name?: string }).name || "anonymous"}]`;

  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }

  if (t === "object") {
    const obj = value as object;
    if (seen.has(obj)) return "[Circular]";
    if (depth >= MAX_DEPTH) return "[Object]";
    seen.add(obj);

    try {
      if (Array.isArray(value)) {
        return `[${value.map((v) => safeStringifyValue(v, depth + 1, seen)).join(", ")}]`;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .slice(0, 20) // cap key count too, not just depth
        .map(([k, v]) => `${k}: ${safeStringifyValue(v, depth + 1, seen)}`);
      return `{${entries.join(", ")}}`;
    } catch {
      return "[Unserializable]";
    }
  }

  return String(value);
}

/** Turn console.* arguments into one safe, bounded-length message string. */
function safeStringifyArgs(args: unknown[]): string {
  const joined = args.map((a) => safeStringifyValue(a)).join(" ");
  return joined.length > MAX_STRING_LENGTH
    ? `${joined.slice(0, MAX_STRING_LENGTH)}... [truncated]`
    : joined;
}

// ---------------------------------------------------------------------------
// Bounded, persisted, debounced log buffer
// ---------------------------------------------------------------------------

let buffer: AptyLogEntry[] = [];
let bufferLoaded = false;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let dirty = false;

async function loadBufferOnce(): Promise<void> {
  if (bufferLoaded) return;
  const result = await chrome.storage.local.get(STORAGE_KEY);
  buffer = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  bufferLoaded = true;
}

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushBuffer();
  }, FLUSH_INTERVAL_MS);
}

async function flushBuffer(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  await chrome.storage.local.set({ [STORAGE_KEY]: buffer });
}

async function appendLog(level: LogLevel, args: unknown[]): Promise<void> {
  await loadBufferOnce();
  buffer.push({
    level,
    message: safeStringifyArgs(args),
    timestamp: Date.now(),
  });
  if (buffer.length > MAX_ENTRIES) {
    buffer = buffer.slice(-MAX_ENTRIES);
  }
  scheduleFlush();
}

// Flush immediately when the service worker is about to be suspended, so a
// debounced-but-not-yet-flushed batch isn't silently lost.
chrome.runtime.onSuspend?.addListener(() => {
  void flushBuffer();
});

// ---------------------------------------------------------------------------
// Console capture — wrap once per service-worker lifetime, not per message
// ---------------------------------------------------------------------------

let consoleWrapped = false;
function installConsoleCapture(): void {
  if (consoleWrapped) return;
  consoleWrapped = true;

  (["log", "warn", "error"] as const).forEach((level) => {
    const original = console[level];
    console[level] = (...args: unknown[]) => {
      void appendLog(level, args);
      original.apply(console, args);
    };
  });
}
if (CAPTURE_CONSOLE) installConsoleCapture();

// ---------------------------------------------------------------------------
// Network calls — the Widget's own requests, made through observedFetch
// ---------------------------------------------------------------------------

const NETWORK_STORAGE_KEY = "apty_sw_network_calls";
const MAX_NETWORK_ENTRIES = 1000;
// Total characters of all kept bodies. chrome.storage.session holds 10 MB
// (Chrome 112+; 1 MB before that), counted on the JSON that is stored, so
// 2,000,000 leaves room for the call list and for non-ASCII text. A value
// to decide with the Widget team, not a measured one.
const MAX_KEPT_BODY_CHARS = 2_000_000;
// The Agent rejects a longer body, so a longer one is not kept at all
// rather than cut into something that is no longer valid JSON.
const MAX_BODY_CHARS = 200_000;

// Matches AptyObservedResource in packages/browser-runtime/src/apty/types.ts,
// with the Agent's own bounds on each field.
interface ObservedCall {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  failed?: boolean;
  errorText?: string;
  timestamp: number;
}

interface KeptBody {
  body: string;
  base64Encoded: boolean;
}

/** Why a call has no kept body, as the Agent's get-resource-body answer names it. */
type MissingBodyReason = "too-large" | "evicted" | "unreadable" | "none";

interface NetworkState {
  calls: ObservedCall[];
  bodies: Record<string, KeptBody>;
  /** Calls whose body was read but could not be kept: "too-large" or "unreadable". */
  notKept?: Record<string, "too-large" | "unreadable">;
}

let network: NetworkState = { calls: [], bodies: {}, notKept: {} };
// Calls whose body is still being read after their status was recorded.
const readingBody = new Set<string>();
let saveFailures = 0;
let lastSaveError: string | undefined;
let networkLoaded: Promise<void> | undefined;
let networkCounter = 0;

function loadNetworkOnce(): Promise<void> {
  networkLoaded ??= chrome.storage.session
    .get(NETWORK_STORAGE_KEY)
    .then((result) => {
      const stored = result[NETWORK_STORAGE_KEY] as NetworkState | undefined;
      if (stored && Array.isArray(stored.calls)) {
        network = {
          calls: [...stored.calls, ...network.calls].slice(
            -MAX_NETWORK_ENTRIES,
          ),
          bodies: { ...stored.bodies, ...network.bodies },
          notKept: { ...stored.notKept, ...network.notKept },
        };
      }
    })
    .catch(() => undefined);
  return networkLoaded;
}

const SAVE_DEBOUNCE_MS = 300;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

async function saveNetwork(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  try {
    await chrome.storage.session.set({ [NETWORK_STORAGE_KEY]: network });
  } catch (error) {
    saveFailures++;
    lastSaveError = bounded(
      error instanceof Error ? error.message : String(error),
      500,
    );
  }
}

/** The last storage.session write error, for the Client's own debugging; the Agent sees only the count. */
export function getLastNetworkSaveError(): string | undefined {
  return lastSaveError;
}

/** One write of the whole state after the calls stop for SAVE_DEBOUNCE_MS, not one per call. */
function scheduleNetworkSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNetwork().catch(() => undefined);
  }, SAVE_DEBOUNCE_MS);
}

chrome.runtime.onSuspend?.addListener(() => {
  if (saveTimer) saveNetwork().catch(() => undefined);
});

function bounded(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function isTextual(mimeType: string | undefined): boolean {
  if (!mimeType) return true;
  return (
    mimeType.startsWith("text/") ||
    /json|xml|javascript|ecmascript|x-www-form-urlencoded/.test(mimeType)
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The URL as fetch resolves it: a relative one against this worker's own
 * location, the way fetch does in a service worker. Anything that can't be
 * resolved is recorded as given.
 */
function absoluteUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  const text = String(input);
  try {
    return new URL(text, globalThis.location?.href).href;
  } catch {
    return text;
  }
}

/** The resource a call belongs to: method + URL without its query string or fragment. */
function resourceKey(call: ObservedCall): string {
  return `${call.method} ${call.url.split(/[?#]/, 1)[0]}`;
}

function isFailure(call: ObservedCall): boolean {
  return call.failed === true || (call.status ?? 0) >= 400;
}

/**
 * Keep the body of the latest successful call and of the latest failed call
 * of each resource, then bring the total under MAX_KEPT_BODY_CHARS: the
 * oldest resources' successful bodies go first, failed bodies last.
 */
function pruneBodies(): void {
  const latestSuccess = new Map<string, string>();
  const latestFailure = new Map<string, string>();
  for (const call of network.calls) {
    if (!(call.requestId in network.bodies)) continue;
    (isFailure(call) ? latestFailure : latestSuccess).set(
      resourceKey(call),
      call.requestId,
    );
  }
  const keep = new Set([...latestSuccess.values(), ...latestFailure.values()]);
  for (const id of Object.keys(network.bodies)) {
    if (!keep.has(id)) delete network.bodies[id];
  }
  let total = Object.values(network.bodies).reduce(
    (sum, kept) => sum + kept.body.length,
    0,
  );
  const successIds = new Set(latestSuccess.values());
  const oldestFirst = network.calls
    .map((c) => c.requestId)
    .filter((id) => id in network.bodies);
  const evictionOrder = [
    ...oldestFirst.filter((id) => successIds.has(id)),
    ...oldestFirst.filter((id) => !successIds.has(id)),
  ];
  for (const id of evictionOrder) {
    if (total <= MAX_KEPT_BODY_CHARS) break;
    total -= network.bodies[id]?.body.length ?? 0;
    delete network.bodies[id];
  }
}

async function record(
  call: ObservedCall,
  body?: KeptBody,
  notKept?: "too-large" | "unreadable",
): Promise<void> {
  await loadNetworkOnce();
  const index = network.calls.findIndex((c) => c.requestId === call.requestId);
  if (index === -1) network.calls.push(call);
  else network.calls[index] = { ...network.calls[index], ...call };
  network.calls = network.calls.slice(-MAX_NETWORK_ENTRIES);
  if (body) network.bodies[call.requestId] = body;
  if (notKept) {
    network.notKept ??= {};
    network.notKept[call.requestId] = notKept;
  }
  pruneBodies();
  const known = new Set(network.calls.map((c) => c.requestId));
  for (const id of Object.keys(network.bodies)) {
    if (!known.has(id)) delete network.bodies[id];
  }
  for (const id of Object.keys(network.notKept ?? {})) {
    if (!known.has(id)) delete network.notKept?.[id];
  }
  scheduleNetworkSave();
}

/** Recording never throws into, or waits inside, the Widget's own fetch. */
function recordSilently(
  call: ObservedCall,
  body?: KeptBody,
  notKept?: "too-large" | "unreadable",
): void {
  record(call, body, notKept).catch(() => undefined);
}

/**
 * At most `maxChars` of the body, read from a clone so the Widget's own
 * Response is untouched; stops reading (and cancels the clone) at the limit.
 * Base64 takes 4 characters per 3 bytes, so binary stops at the byte count
 * that encodes to `maxChars`.
 */
async function readBounded(
  response: Response,
  textual: boolean,
  maxChars: number,
): Promise<{ body: KeptBody; truncated: boolean } | undefined> {
  let stream: ReadableStream<Uint8Array> | null;
  try {
    stream = response.clone().body;
  } catch {
    return undefined;
  }
  if (!stream)
    return { body: { body: "", base64Encoded: !textual }, truncated: false };
  const reader = stream.getReader();
  const maxBytes = Math.floor(maxChars / 4) * 3;
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let text = "";
  let bytes = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (textual) {
        text += decoder.decode(value, { stream: true });
        if (text.length > maxChars) {
          truncated = true;
          break;
        }
      } else {
        chunks.push(value);
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          truncated = true;
          break;
        }
      }
    }
  } catch {
    return undefined;
  } finally {
    if (truncated) reader.cancel().catch(() => undefined);
  }
  if (textual) {
    text = truncated ? text.slice(0, maxChars) : text + decoder.decode();
    return { body: { body: text, base64Encoded: false }, truncated };
  }
  const all = new Uint8Array(Math.min(bytes, truncated ? maxBytes : bytes));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, all.length - offset);
    all.set(part, offset);
    offset += part.length;
    if (offset >= all.length) break;
  }
  return { body: { body: base64(all), base64Encoded: true }, truncated };
}

/** The body, recorded after the Widget already has its Response. */
async function recordBody(
  call: ObservedCall,
  response: Response,
  mimeType?: string,
) {
  readingBody.add(call.requestId);
  try {
    const read = await readBounded(
      response,
      isTextual(mimeType),
      MAX_BODY_CHARS,
    );
    // A body cut at the limit is not kept, so the Agent never reads part of
    // one as if it were whole: it hears found: false, reason "too-large".
    if (!read) recordSilently(call, undefined, "unreadable");
    else if (read.truncated) recordSilently(call, undefined, "too-large");
    else recordSilently(call, read.body);
  } finally {
    readingBody.delete(call.requestId);
  }
}

/** Why `requestId` has no kept body; undefined while that is not yet known (the call or its body is still arriving). */
function missingBodyReason(requestId: string): MissingBodyReason | undefined {
  const noted = network.notKept?.[requestId];
  if (noted) return noted;
  const call = network.calls.find((c) => c.requestId === requestId);
  if (!call) return "evicted";
  if (call.failed) return "none";
  if (call.status === undefined || readingBody.has(requestId)) return undefined;
  return "evicted";
}

/**
 * `fetch`, plus a record the Agent can read: the call as soon as it starts
 * (no status yet), then its status, or `failed` with the error. The Widget
 * gets the same Response, or the same error, as soon as fetch gives it:
 * recording and reading the body happen afterwards and never throw into it.
 */
export async function observedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let call: ObservedCall | undefined;
  try {
    const request = input instanceof Request ? input : undefined;
    call = {
      requestId: `w${Date.now().toString(36)}-${++networkCounter}`,
      url: bounded(absoluteUrl(input), 4000),
      method: bounded(
        (init?.method ?? request?.method ?? "GET").toUpperCase(),
        20,
      ),
      timestamp: Date.now(),
    };
    recordSilently(call);
  } catch {
    call = undefined;
  }
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (call) {
      try {
        recordSilently({
          ...call,
          failed: true,
          errorText: bounded(
            error instanceof Error ? error.message : String(error),
            2000,
          ),
        });
      } catch {
        // Recording must never change what the Widget's fetch throws.
      }
    }
    throw error;
  }
  if (call) {
    try {
      const mimeType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim();
      const answered: ObservedCall = {
        ...call,
        status: response.status,
        ...(mimeType ? { mimeType: bounded(mimeType, 200) } : {}),
      };
      recordSilently(answered);
      recordBody(answered, response, mimeType).catch(() => undefined);
    } catch {
      // Recording must never change the Response the Widget gets.
    }
  }
  return response;
}

// ---------------------------------------------------------------------------
// External message handler — validated, allowlisted, schema-shaped responses
// ---------------------------------------------------------------------------

/**
 * The two network verbs. A Widget or Client that already has an
 * onMessageExternal listener calls this at the end of it, after its own sender
 * check and status/logs branches, instead of registering the listener below:
 * two listeners answering one message is a race. Returns whether it will
 * answer asynchronously, as the listener's own return value.
 */
export function handleNetworkMessage(
  message: { type?: unknown; requestId?: unknown },
  sendResponse: (response: unknown) => void,
): boolean {
  if (message.type === "apty-debug-agent:list-observed-resources") {
    (async () => {
      await loadNetworkOnce();
      sendResponse({
        resources: network.calls.map((c) => ({
          ...c,
          hasBody: c.requestId in network.bodies,
        })),
        saveFailures,
      });
    })();
    return true;
  }

  if (message.type === "apty-debug-agent:get-resource-body") {
    const requestId = message.requestId;
    if (typeof requestId !== "string") return false;
    (async () => {
      await loadNetworkOnce();
      const kept = network.bodies[requestId];
      const reason = missingBodyReason(requestId);
      sendResponse(
        kept
          ? {
              found: true,
              body: kept.body,
              base64Encoded: kept.base64Encoded,
            }
          : { found: false, ...(reason ? { reason } : {}) },
      );
    })();
    return true;
  }

  return false;
}

// Stand-in for the host's own listener: a host that has one calls
// handleNetworkMessage from it and leaves this out.
chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    // Reject anything not from the specific, configured debugging-agent
    // extension. No response is sent to unrecognized senders — never
    // acknowledge or leak status information to an unexpected caller.
    if (!sender.id || !DEBUG_AGENT_EXTENSION_IDS.includes(sender.id)) {
      return false;
    }

    if (!message || typeof message.type !== "string") {
      return false;
    }

    if (message.type === "apty-debug-agent:get-service-worker-status") {
      sendResponse({
        running: true,
        lastActivity: Date.now(),
      });
      return true;
    }

    if (message.type === "apty-debug-agent:get-service-worker-logs") {
      (async () => {
        await loadBufferOnce();
        sendResponse({ logs: buffer });
      })();
      return true; // keep the message channel open for the async response
    }

    return handleNetworkMessage(message, sendResponse);
  },
);

// ---------------------------------------------------------------------------
// Manifest requirement for the Apty Widget's own manifest.json:
//
//   "externally_connectable": {
//     "ids": ["bpiondflhhdplemamgggcdajclmoeple",
//             "<the Agent's Chrome Web Store ID, once assigned>"]
//   }
//
// Use the SAME IDs as DEBUG_AGENT_EXTENSION_IDS above. Never use a wildcard
// ("ids": ["*"]) or omit externally_connectable's ids restriction — either
// would let any installed extension query these diagnostics.
// ---------------------------------------------------------------------------
