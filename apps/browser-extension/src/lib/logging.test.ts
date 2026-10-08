import { getLogLevel, STORAGE_KEYS, setLogLevel } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initLogging } from "./logging";

type ChangeListener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

let stored: Record<string, unknown>;
let changeListeners: ChangeListener[];
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  stored = {};
  changeListeners = [];
  (globalThis as any).chrome = {
    storage: {
      local: { get: vi.fn(async (key: string) => ({ [key]: stored[key] })) },
      onChanged: {
        addListener: (listener: ChangeListener) =>
          changeListeners.push(listener),
      },
    },
  };
  vi.stubEnv("DEV", false);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setLogLevel("debug");
});

describe("initLogging", () => {
  it("logs warnings and errors only in a production build", async () => {
    initLogging();
    await flush();
    expect(getLogLevel()).toBe("warn");
  });

  it("follows the Verbose logging setting as it changes", async () => {
    stored[STORAGE_KEYS.SETTINGS] = { verboseLogging: true };
    initLogging();
    await flush();
    expect(getLogLevel()).toBe("debug");

    for (const listener of changeListeners) {
      listener(
        { [STORAGE_KEYS.SETTINGS]: { newValue: { verboseLogging: false } } },
        "local",
      );
    }
    expect(getLogLevel()).toBe("warn");
  });

  it("never reads storage from a content script", async () => {
    initLogging({ followSettings: false });
    await flush();
    expect(chrome.storage.local.get).not.toHaveBeenCalled();
    expect(changeListeners).toHaveLength(0);
    expect(getLogLevel()).toBe("warn");
  });
});
