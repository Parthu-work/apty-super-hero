/**
 * Apty console bridge (MAIN world)
 *
 * Runs in the page's own JS context (not the isolated content-script world)
 * so it can see console output and errors from the Apty widget and the host
 * application itself. Buffers recent entries on `window` so the
 * `get_apty_debug_logs` tool (packages/browser-runtime/src/tools/apty.ts)
 * can read them via `chrome.scripting.executeScript`.
 *
 * This is a generic capture bridge — it does not assume anything about the
 * Apty widget's internals. If/when the Apty widget exposes a richer debug
 * contract (e.g. `window.__APTY_WIDGET__.getDebugSnapshot()`), the same tool
 * file is the place to add a second, structured code path alongside this one.
 */

export {};

const BUFFER_KEY = "__aptyAgentConsoleBuffer";
const MAX_ENTRIES = 500;

interface AptyConsoleEntry {
  level: "log" | "info" | "warn" | "error" | "debug";
  message: string;
  timestamp: number;
  source: "console" | "window-error" | "unhandled-rejection";
}

declare global {
  interface Window {
    __aptyAgentConsoleBuffer?: AptyConsoleEntry[];
    __aptyBridgeInstalled?: boolean;
  }
}

function ensureBuffer(): AptyConsoleEntry[] {
  if (!window[BUFFER_KEY]) {
    window[BUFFER_KEY] = [];
  }
  return window[BUFFER_KEY] as AptyConsoleEntry[];
}

function push(entry: AptyConsoleEntry) {
  const buffer = ensureBuffer();
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
}

function stringifyArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

function wrapConsoleMethod(
  level: AptyConsoleEntry["level"],
  original: (...args: unknown[]) => void,
) {
  return (...args: unknown[]) => {
    push({
      level,
      message: stringifyArgs(args),
      timestamp: Date.now(),
      source: "console",
    });
    original.apply(console, args);
  };
}

// Avoid double-patching if the bridge is injected more than once (e.g. an
// extension reload without a full page reload).
if (!window.__aptyBridgeInstalled) {
  window.__aptyBridgeInstalled = true;
  ensureBuffer();

  console.log = wrapConsoleMethod("log", console.log);
  console.info = wrapConsoleMethod("info", console.info);
  console.warn = wrapConsoleMethod("warn", console.warn);
  console.error = wrapConsoleMethod("error", console.error);
  console.debug = wrapConsoleMethod("debug", console.debug);

  window.addEventListener("error", (event) => {
    push({
      level: "error",
      message: `${event.message} (${event.filename}:${event.lineno}:${event.colno})`,
      timestamp: Date.now(),
      source: "window-error",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    push({
      level: "error",
      message: `Unhandled rejection: ${String(event.reason)}`,
      timestamp: Date.now(),
      source: "unhandled-rejection",
    });
  });
}
