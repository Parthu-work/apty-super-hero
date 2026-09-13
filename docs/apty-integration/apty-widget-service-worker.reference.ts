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
 * (live Apty service-worker diagnostics, see PROJECT_PROGRESS.md /
 * ARCHITECTURE.md): the code that should live inside the Apty Widget's own
 * Manifest V3 service worker so the Apty Live Browser Debugging Agent can
 * request its status and recent logs. The debugging agent's consumer side
 * already exists and matches this exact contract — see
 * packages/browser-runtime/src/apty/service-worker-diagnostics.ts.
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
 * DESIGN DECISIONS (see PROJECT_PROGRESS.md / DECISIONS.md for the parallel
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
 * 5. Sender validation — only responds to the specific, configured
 *    debugging-agent extension ID. There is no wildcard path. A request
 *    from any other sender.id is ignored (no response sent), not merely
 *    "logged and allowed."
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * -----------------------------------
 * - Redact sensitive values before storing/returning them. Apty's own log
 *   call sites are the right place to avoid logging secrets in the first
 *   place; the debugging agent's consumer side (redact.ts) also redacts
 *   anything that slips through as defense in depth, but don't rely on
 *   that as the only safeguard — avoid logging tokens/passwords/cookies
 *   from this service worker at all.
 * - Send logs anywhere off the Widget's own extension. No network calls
 *   are made in this file; this is a local (extension-to-extension
 *   message-passing) mechanism only.
 */

// ---------------------------------------------------------------------------
// Config — fill in with the real debugging agent's extension ID once known.
// Do not use a wildcard/placeholder in production.
// ---------------------------------------------------------------------------
const DEBUG_AGENT_EXTENSION_ID =
  "<the Apty Debugging Agent's real extension ID>";

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
// External message handler — validated, allowlisted, schema-shaped responses
// ---------------------------------------------------------------------------

chrome.runtime.onMessageExternal.addListener(
  (message, sender, sendResponse) => {
    // Reject anything not from the specific, configured debugging-agent
    // extension. No response is sent to unrecognized senders — never
    // acknowledge or leak status information to an unexpected caller.
    if (sender.id !== DEBUG_AGENT_EXTENSION_ID) {
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

    return false;
  },
);

// ---------------------------------------------------------------------------
// Manifest requirement for the Apty Widget's own manifest.json:
//
//   "externally_connectable": {
//     "ids": ["<the Apty Debugging Agent's real extension ID>"]
//   }
//
// Use the SAME id as DEBUG_AGENT_EXTENSION_ID above. Never use a wildcard
// ("ids": ["*"]) or omit externally_connectable's ids restriction — either
// would let any installed extension query these diagnostics.
// ---------------------------------------------------------------------------
