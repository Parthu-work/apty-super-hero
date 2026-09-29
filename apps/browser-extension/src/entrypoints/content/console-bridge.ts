/**
 * Apty console bridge (MAIN world)
 *
 * Runs in the page's own JS context (not the isolated content-script world),
 * once per frame (`all_frames: true` in manifest.json), so it can see
 * console output and errors from the Apty widget, any iframe, and the host
 * application itself. The `get_apty_page_logs` tool
 * (packages/browser-runtime/src/tools/apty.ts) reads the buffer back via
 * `chrome.scripting.executeScript({ allFrames: true })`.
 *
 * Hard guarantees, because this hook sits between every `console.*` call
 * (and page error) and the real console — a bug here breaks the host page,
 * not just this extension:
 *
 * - NEVER throws back into the caller. Every wrapper is try/catch'd around
 *   both our own bookkeeping and the call to the original console method.
 * - NEVER trusts anything the page could have forged. The old version
 *   stored the buffer at a plain, writable `window.__aptyAgentConsoleBuffer`
 *   property, so any page script could overwrite it with fabricated
 *   entries before the tool read it back. The buffer now lives only in this
 *   script's closure; the only thing exposed on `window` is a
 *   non-enumerable, non-writable, non-configurable function that returns a
 *   *copy* of the real buffer.
 * - Bounded in size (entry count and total byte budget) and rate (entries
 *   per second), so a page in an infinite logging loop can't grow memory
 *   without bound or flood the model with thousands of near-duplicate
 *   lines.
 */

import {
  capEntryLength,
  formatConsoleArgs,
  safeSerialize,
} from "@apty/debug-contract";

const READ_FN_KEY = "__aptyReadConsoleBuffer";

const MAX_ENTRIES = 500;
const MAX_BUFFER_BYTES = 512 * 1024;
const RATE_LIMIT_PER_SECOND = 200;
const RATE_WINDOW_MS = 1000;

type AptyConsoleLevel =
  | "log"
  | "info"
  | "warn"
  | "error"
  | "debug"
  | "trace"
  | "dir"
  | "table"
  | "assert";

type AptyConsoleSource =
  | "console"
  | "window-error"
  | "resource-error"
  | "unhandled-rejection"
  | "csp-violation";

interface AptyConsoleEntry {
  seq: number;
  level: AptyConsoleLevel;
  message: string;
  timestamp: number;
  source: AptyConsoleSource;
  repeat?: number;
}

declare global {
  interface Window {
    [READ_FN_KEY]?: () => AptyConsoleEntry[];
  }
}

// Guard against the script somehow running twice in the same frame (e.g. a
// dev-mode extension reload without a page reload) — re-wrapping console
// methods that are already wrapped would double-log everything.
if (typeof window[READ_FN_KEY] !== "function") {
  installConsoleBridge();
}

function installConsoleBridge(): void {
  try {
    const entries: AptyConsoleEntry[] = [];
    let seqCounter = 0;
    let approxBytes = 0;

    let rateWindowStart = Date.now();
    let rateWindowCount = 0;
    let rateDroppedInWindow = 0;

    const entryBytes = (entry: AptyConsoleEntry) =>
      entry.message.length * 2 + 64;

    function evictIfNeeded(): void {
      while (
        entries.length > MAX_ENTRIES ||
        (approxBytes > MAX_BUFFER_BYTES && entries.length > 0)
      ) {
        const removed = entries.shift();
        if (!removed) break;
        approxBytes -= entryBytes(removed);
      }
    }

    function pushRaw(
      partial: Omit<AptyConsoleEntry, "seq">,
      coalesce: boolean,
    ): void {
      if (coalesce) {
        const last = entries[entries.length - 1];
        if (
          last &&
          last.level === partial.level &&
          last.source === partial.source &&
          last.message === partial.message
        ) {
          last.repeat = (last.repeat ?? 1) + 1;
          last.timestamp = partial.timestamp;
          return;
        }
      }
      const entry: AptyConsoleEntry = { seq: ++seqCounter, ...partial };
      entries.push(entry);
      approxBytes += entryBytes(entry);
      evictIfNeeded();
    }

    /** Rate-gated entry point for real log events; flushes a coalesced "N dropped" marker when a rate window closes with drops in it. */
    function push(partial: Omit<AptyConsoleEntry, "seq">): void {
      const now = partial.timestamp;
      if (now - rateWindowStart >= RATE_WINDOW_MS) {
        if (rateDroppedInWindow > 0) {
          pushRaw(
            {
              level: "warn",
              message: `[${rateDroppedInWindow} log entries dropped — rate limit of ${RATE_LIMIT_PER_SECOND}/s exceeded]`,
              source: "console",
              timestamp: now,
            },
            false,
          );
        }
        rateWindowStart = now;
        rateWindowCount = 0;
        rateDroppedInWindow = 0;
      }
      rateWindowCount++;
      if (rateWindowCount > RATE_LIMIT_PER_SECOND) {
        rateDroppedInWindow++;
        return;
      }
      pushRaw(partial, true);
    }

    function readBuffer(): AptyConsoleEntry[] {
      // A defensive copy — callers (including the extension's own read
      // side) must never get a live reference into the closure buffer.
      return entries.map((entry) => ({ ...entry }));
    }

    // Several native console methods delegate internally to another
    // console method on the same `this` (e.g. Node's `console.assert` and
    // `console.trace` both call through to `this.error`/`this.warn` when
    // forwarding to the real implementation below) — since those methods
    // are themselves wrapped, calling the original with `this: console`
    // would otherwise re-enter our hook and record the same event twice.
    // This flag is set for the duration of exactly one "call the real
    // original" invocation so any such re-entrant call skips recording
    // (but still reaches the real console, so real output is unaffected).
    let suppressPush = false;

    function callOriginal(original: (...args: any[]) => void, args: any[]) {
      const wasSuppressed = suppressPush;
      suppressPush = true;
      try {
        original.apply(console, args);
      } catch {
        // A hostile arg (e.g. a throwing getter) could make even the
        // native console throw in some engines — still must not escape.
      } finally {
        suppressPush = wasSuppressed;
      }
    }

    function guardedPush(record: () => void): void {
      if (suppressPush) return;
      try {
        record();
      } catch {
        // Bridge bookkeeping must never prevent the real console call below.
      }
    }

    function wrapConsoleMethod(
      level: AptyConsoleLevel,
      original: (...args: unknown[]) => void,
    ) {
      return (...args: unknown[]) => {
        guardedPush(() =>
          push({
            level,
            message: capEntryLength(formatConsoleArgs(args)),
            timestamp: Date.now(),
            source: "console",
          }),
        );
        callOriginal(original, args);
      };
    }

    function wrapAssert(original: (...args: any[]) => void) {
      return (condition?: unknown, ...data: unknown[]) => {
        guardedPush(() => {
          if (!condition) {
            const detail = data.length ? formatConsoleArgs(data) : "";
            push({
              level: "assert",
              message: capEntryLength(
                detail ? `Assertion failed: ${detail}` : "Assertion failed",
              ),
              timestamp: Date.now(),
              source: "console",
            });
          }
        });
        callOriginal(original, [condition, ...data]);
      };
    }

    function wrapTrace(original: (...args: unknown[]) => void) {
      return (...args: unknown[]) => {
        guardedPush(() => {
          const stack =
            typeof new Error().stack === "string"
              ? (new Error().stack as string)
              : "";
          const header = args.length ? formatConsoleArgs(args) : "Trace";
          push({
            level: "trace",
            message: capEntryLength(stack ? `${header}\n${stack}` : header),
            timestamp: Date.now(),
            source: "console",
          });
        });
        callOriginal(original, args);
      };
    }

    function wrapValueDump(
      level: "dir" | "table",
      original: (...args: any[]) => void,
    ) {
      return (...args: unknown[]) => {
        guardedPush(() =>
          push({
            level,
            message: capEntryLength(safeSerialize(args[0])),
            timestamp: Date.now(),
            source: "console",
          }),
        );
        callOriginal(original, args);
      };
    }

    console.log = wrapConsoleMethod("log", console.log);
    console.info = wrapConsoleMethod("info", console.info);
    console.warn = wrapConsoleMethod("warn", console.warn);
    console.error = wrapConsoleMethod("error", console.error);
    console.debug = wrapConsoleMethod("debug", console.debug);
    console.assert = wrapAssert(console.assert);
    console.trace = wrapTrace(console.trace);
    console.dir = wrapValueDump("dir", console.dir);
    console.table = wrapValueDump("table", console.table);

    // `capture: true` is required to observe resource-load failures
    // (`<img>`/`<script>`/`<link>` 404s) — those `error` events fire on the
    // element and never bubble to `window`, only capture from the top.
    window.addEventListener(
      "error",
      (event: Event) => {
        try {
          const target = event.target as
            | (EventTarget & {
                tagName?: string;
                src?: string;
                href?: string;
              })
            | null;

          if (target && target !== window && target.tagName) {
            const location = target.src ?? target.href ?? "";
            push({
              level: "error",
              message: capEntryLength(
                `Resource failed to load: <${target.tagName.toLowerCase()}> ${location}`,
              ),
              timestamp: Date.now(),
              source: "resource-error",
            });
            return;
          }

          const errorEvent = event as ErrorEvent;
          const detail =
            errorEvent.error !== undefined
              ? safeSerialize(errorEvent.error)
              : (errorEvent.message ?? "Uncaught error");
          push({
            level: "error",
            message: capEntryLength(
              `${errorEvent.message ?? "Uncaught error"} (${errorEvent.filename ?? ""}:${errorEvent.lineno ?? 0}:${errorEvent.colno ?? 0})\n${detail}`,
            ),
            timestamp: Date.now(),
            source: "window-error",
          });
        } catch {
          // ignore
        }
      },
      true,
    );

    window.addEventListener("unhandledrejection", (event) => {
      try {
        const reason = event.reason;
        const detail =
          reason instanceof Error
            ? safeSerialize(reason)
            : safeSerialize(reason);
        push({
          level: "error",
          message: capEntryLength(`Unhandled promise rejection: ${detail}`),
          timestamp: Date.now(),
          source: "unhandled-rejection",
        });
      } catch {
        // ignore
      }
    });

    window.addEventListener("securitypolicyviolation", (event) => {
      try {
        push({
          level: "error",
          message: capEntryLength(
            `CSP violation: ${event.violatedDirective} blocked ${event.blockedURI} (effective directive: ${event.effectiveDirective})`,
          ),
          timestamp: Date.now(),
          source: "csp-violation",
        });
      } catch {
        // ignore
      }
    });

    try {
      Object.defineProperty(window, READ_FN_KEY, {
        value: readBuffer,
        writable: false,
        enumerable: false,
        configurable: false,
      });
    } catch {
      // Some earlier script predefined this property as non-configurable —
      // nothing we can do; the read side will see no function in this frame
      // and must report it as unavailable rather than guessing.
    }
  } catch {
    // Installation itself must never throw into the host page's script
    // evaluation, even if every guard above somehow failed.
  }
}
