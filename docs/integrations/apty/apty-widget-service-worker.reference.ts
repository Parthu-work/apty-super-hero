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
 *    registered on every service-worker start.
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
 *    never written to disk and are gone when the browser closes. At most
 *    MAX_NETWORK_ENTRIES calls are kept, and response bodies only for the
 *    MAX_KEPT_BODIES most recent calls; a body over MAX_BODY_CHARS (the
 *    Agent's own limit) is not kept, and the Agent is told so (found:
 *    false). Non-text bodies are kept base64-encoded.
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
installConsoleCapture();

// ---------------------------------------------------------------------------
// Network calls — the Widget's own requests, made through observedFetch
// ---------------------------------------------------------------------------

const NETWORK_STORAGE_KEY = "apty_sw_network_calls";
const MAX_NETWORK_ENTRIES = 1000;
const MAX_KEPT_BODIES = 10;
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

interface NetworkState {
  calls: ObservedCall[];
  bodies: Record<string, KeptBody>;
}

let network: NetworkState = { calls: [], bodies: {} };
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
        };
      }
    })
    .catch(() => undefined);
  return networkLoaded;
}

async function saveNetwork(): Promise<void> {
  await chrome.storage.session
    .set({ [NETWORK_STORAGE_KEY]: network })
    .catch(() => undefined);
}

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

function base64(bytes: ArrayBuffer): string {
  let binary = "";
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function record(call: ObservedCall, body?: KeptBody): Promise<void> {
  await loadNetworkOnce();
  const index = network.calls.findIndex((c) => c.requestId === call.requestId);
  if (index === -1) network.calls.push(call);
  else network.calls[index] = call;
  network.calls = network.calls.slice(-MAX_NETWORK_ENTRIES);
  if (body) network.bodies[call.requestId] = body;
  // Keep bodies only for the most recent calls that still have one.
  const keep = new Set(
    network.calls
      .map((c) => c.requestId)
      .filter((id) => id in network.bodies)
      .slice(-MAX_KEPT_BODIES),
  );
  for (const id of Object.keys(network.bodies)) {
    if (!keep.has(id)) delete network.bodies[id];
  }
  await saveNetwork();
}

async function keptBody(response: Response): Promise<KeptBody | undefined> {
  const mimeType = response.headers.get("content-type") ?? undefined;
  try {
    if (isTextual(mimeType)) {
      const body = await response.clone().text();
      return body.length > MAX_BODY_CHARS
        ? undefined
        : { body, base64Encoded: false };
    }
    const body = base64(await response.clone().arrayBuffer());
    return body.length > MAX_BODY_CHARS
      ? undefined
      : { body, base64Encoded: true };
  } catch {
    return undefined;
  }
}

/**
 * `fetch`, plus a record the Agent can read: the call as soon as it starts
 * (no status yet), then its status and body, or `failed` with the error.
 * The Widget gets the same Response, or the same error, it would have got.
 */
export async function observedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const request = input instanceof Request ? input : undefined;
  const call: ObservedCall = {
    requestId: `w${Date.now().toString(36)}-${++networkCounter}`,
    url: bounded(request ? request.url : String(input), 4000),
    method: bounded(
      (init?.method ?? request?.method ?? "GET").toUpperCase(),
      20,
    ),
    timestamp: Date.now(),
  };
  await record(call);
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    await record({
      ...call,
      failed: true,
      errorText: bounded(
        error instanceof Error ? error.message : String(error),
        2000,
      ),
    });
    throw error;
  }
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim();
  await record(
    {
      ...call,
      status: response.status,
      ...(mimeType ? { mimeType: bounded(mimeType, 200) } : {}),
    },
    await keptBody(response),
  );
  return response;
}

// ---------------------------------------------------------------------------
// External message handler — validated, allowlisted, schema-shaped responses
// ---------------------------------------------------------------------------

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

    if (message.type === "apty-debug-agent:list-observed-resources") {
      (async () => {
        await loadNetworkOnce();
        sendResponse({ resources: network.calls });
      })();
      return true;
    }

    if (message.type === "apty-debug-agent:get-resource-body") {
      if (typeof message.requestId !== "string") return false;
      (async () => {
        await loadNetworkOnce();
        const kept = network.bodies[message.requestId];
        sendResponse(
          kept
            ? {
                found: true,
                body: kept.body,
                base64Encoded: kept.base64Encoded,
              }
            : { found: false },
        );
      })();
      return true;
    }

    return false;
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
