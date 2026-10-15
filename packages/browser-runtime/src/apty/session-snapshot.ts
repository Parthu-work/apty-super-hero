/**
 * Write-through snapshots of in-memory diagnostic state to
 * `chrome.storage.session`, so an investigation survives the side panel
 * reloading or the service worker being restarted. Session storage lives
 * in memory only and is cleared when the browser closes.
 */

import { createLogger } from "@apty/agent-core";

const log = createLogger("SessionSnapshot");

const SAVE_DEBOUNCE_MS = 250;

/**
 * The side panel and the service worker each keep their own copy of this
 * state; one key per context stops either from overwriting the other.
 */
export type SnapshotContext = "page" | "worker";

export type SnapshotWriteResult = "saved" | "failed" | "unavailable";

export interface SessionSnapshot {
  /** Resolves once stored state (if any) has been restored. */
  ready: Promise<void>;
  scheduleSave: () => void;
  /** Write now, cancelling a pending debounced save. */
  flush: () => Promise<SnapshotWriteResult>;
}

function currentContext(): SnapshotContext {
  const scope = globalThis as { ServiceWorkerGlobalScope?: unknown };
  return typeof scope.ServiceWorkerGlobalScope === "function" &&
    typeof document === "undefined"
    ? "worker"
    : "page";
}

function sessionArea(): chrome.storage.StorageArea | undefined {
  try {
    return typeof chrome !== "undefined" ? chrome.storage?.session : undefined;
  } catch {
    return undefined;
  }
}

export function createSessionSnapshot<T>(
  key: string,
  serialize: () => T,
  restore: (value: T) => void,
  context: SnapshotContext = currentContext(),
): SessionSnapshot {
  const storageKey = `${key}:${context}`;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = async (): Promise<SnapshotWriteResult> => {
    const area = sessionArea();
    if (!area) return "unavailable";
    try {
      await area.set({ [storageKey]: serialize() });
      return "saved";
    } catch {
      // Quota or serialization failure: in-memory state stays
      // authoritative. Say so without the content or the error text.
      log.warn("session_snapshot_write_failed", key);
      return "failed";
    }
  };

  const ready = (async () => {
    const area = sessionArea();
    if (!area) return;
    try {
      const stored = (await area.get(storageKey))[storageKey] as T | undefined;
      if (stored !== undefined) restore(stored);
    } catch {
      // Unreadable snapshot: start empty rather than fail every tool.
      log.warn("session_snapshot_read_failed", key);
    }
  })();

  return {
    ready,
    scheduleSave: () => {
      if (!sessionArea()) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void write();
      }, SAVE_DEBOUNCE_MS);
    },
    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return write();
    },
  };
}
