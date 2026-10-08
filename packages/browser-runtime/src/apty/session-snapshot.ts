/**
 * Write-through snapshots of in-memory diagnostic state to
 * `chrome.storage.session`, so an investigation survives the side panel
 * reloading or the service worker being restarted. Session storage lives
 * in memory only and is cleared when the browser closes.
 */

const SAVE_DEBOUNCE_MS = 250;

export interface SessionSnapshot {
  /** Resolves once stored state (if any) has been restored. */
  ready: Promise<void>;
  scheduleSave: () => void;
  /** Write now, cancelling a pending debounced save. */
  flush: () => Promise<void>;
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
): SessionSnapshot {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = async () => {
    const area = sessionArea();
    if (!area) return;
    try {
      await area.set({ [key]: serialize() });
    } catch {
      // Quota or serialization failure: in-memory state stays authoritative.
    }
  };

  const ready = (async () => {
    const area = sessionArea();
    if (!area) return;
    try {
      const stored = (await area.get(key))[key] as T | undefined;
      if (stored !== undefined) restore(stored);
    } catch {
      // Unreadable snapshot: start empty rather than fail every tool.
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
      await write();
    },
  };
}
