export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_ORDER: Record<Exclude<LogLevel, "silent">, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "debug";

/** Process-wide minimum level; anything below it is a no-op. Defaults to "debug" (log everything) — the same volume of output every existing `console.*` call already produces, so adopting `createLogger` at a call site is a pure rename until something explicitly calls this. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: Exclude<LogLevel, "silent">): boolean {
  if (currentLevel === "silent") return false;
  return (
    LEVEL_ORDER[level] >=
    LEVEL_ORDER[currentLevel as Exclude<LogLevel, "silent">]
  );
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/** A namespaced logger — `createLogger("QuickJS").debug("loaded", url)` reproduces today's `console.log("[QuickJS] loaded", url)` exactly, but can be silenced process-wide via `setLogLevel` without touching every call site again. */
export function createLogger(namespace: string): Logger {
  const prefix = `[${namespace}]`;
  return {
    debug: (...args: unknown[]) => {
      if (shouldLog("debug")) console.debug(prefix, ...args);
    },
    info: (...args: unknown[]) => {
      if (shouldLog("info")) console.info(prefix, ...args);
    },
    warn: (...args: unknown[]) => {
      if (shouldLog("warn")) console.warn(prefix, ...args);
    },
    error: (...args: unknown[]) => {
      if (shouldLog("error")) console.error(prefix, ...args);
    },
  };
}
