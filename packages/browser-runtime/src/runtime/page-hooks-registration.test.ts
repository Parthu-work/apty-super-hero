import { STORAGE_KEYS } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Registration = chrome.scripting.RegisteredContentScript;
type ChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  areaName: string,
) => void;

let registered: Registration[] = [];
let storedSettings: unknown;
let failNextRead = false;
let changeListeners: ChangeListener[] = [];
const register = vi.fn(async (scripts: Registration[]) => {
  registered.push(...scripts);
});
const unregister = vi.fn(async ({ ids }: { ids: string[] }) => {
  registered = registered.filter((r) => !ids.includes(r.id));
});

(global as any).chrome = {
  scripting: {
    getRegisteredContentScripts: async ({ ids }: { ids: string[] }) =>
      registered.filter((r) => ids.includes(r.id)),
    registerContentScripts: register,
    unregisterContentScripts: unregister,
  },
  storage: {
    local: {
      get: async (key: string) => {
        if (failNextRead) {
          failNextRead = false;
          throw new Error("storage unavailable");
        }
        return { [key]: storedSettings };
      },
    },
    onChanged: {
      addListener: (listener: ChangeListener) => changeListeners.push(listener),
    },
  },
};

import {
  CONSOLE_BRIDGE_FILE,
  CONSOLE_BRIDGE_SCRIPT_ID,
  desiredRegistration,
  excludeMatchesFor,
  pageHooksAllowedOn,
  reconcilePageHooks,
  SETTINGS_UNREADABLE,
  watchPageHookSettings,
} from "./page-hooks-registration";

beforeEach(() => {
  registered = [];
  storedSettings = undefined;
  changeListeners = [];
  register.mockClear();
  unregister.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("excludeMatchesFor", () => {
  it("turns a host into patterns for it and its subdomains", () => {
    expect(excludeMatchesFor([" Bank.Example.com ", ""])).toEqual({
      patterns: ["*://bank.example.com/*", "*://*.bank.example.com/*"],
      invalid: [],
    });
  });

  it("keeps valid match patterns and reports what it can't use", () => {
    expect(
      excludeMatchesFor([
        "https://*.example.org/app/*",
        "https://exa mple.org/*",
        "not a host/",
      ]),
    ).toEqual({
      patterns: ["https://*.example.org/app/*"],
      invalid: ["https://exa mple.org/*", "not a host/"],
    });
  });
});

describe("pageHooksAllowedOn", () => {
  it.each([
    ["on by default", undefined, "https://app.example.com/", true],
    [
      "off when the switch is off",
      { pageHooksEnabled: false },
      "https://app.example.com/",
      false,
    ],
    [
      "off on an excluded host",
      { pageHooksExcludedSites: ["example.com"] },
      "https://app.example.com/x",
      false,
    ],
    [
      "on for a host that only ends the same way",
      { pageHooksExcludedSites: ["example.com"] },
      "https://notexample.com/",
      true,
    ],
  ])("%s", (_label, settings, url, allowed) => {
    expect(pageHooksAllowedOn(url, settings ?? null)).toBe(allowed);
  });

  it("is off when the settings could not be read", () => {
    expect(
      pageHooksAllowedOn("https://app.example.com/", SETTINGS_UNREADABLE),
    ).toBe(false);
  });

  it("is off for a URL it cannot parse", () => {
    expect(pageHooksAllowedOn("not a url", null)).toBe(false);
  });
});

describe("desiredRegistration", () => {
  it("registers the bridge in the page world at document start on every frame", () => {
    expect(desiredRegistration(null)).toEqual({
      id: CONSOLE_BRIDGE_SCRIPT_ID,
      js: [CONSOLE_BRIDGE_FILE],
      matches: ["<all_urls>"],
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: "document_start",
      world: "MAIN",
      persistAcrossSessions: true,
    });
  });

  it("excludes the listed sites, and nothing when the switch is off", () => {
    expect(
      desiredRegistration({ pageHooksExcludedSites: ["bank.example"] })
        ?.excludeMatches,
    ).toEqual(["*://bank.example/*", "*://*.bank.example/*"]);
    expect(desiredRegistration({ pageHooksEnabled: false })).toBeNull();
  });
});

describe("reconcilePageHooks", () => {
  it("registers, then leaves an identical registration alone", async () => {
    await expect(reconcilePageHooks()).resolves.toBe("registered");
    await expect(reconcilePageHooks()).resolves.toBe("unchanged");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it("replaces the registration when the excluded sites change", async () => {
    await reconcilePageHooks({});
    await expect(
      reconcilePageHooks({ pageHooksExcludedSites: ["bank.example"] }),
    ).resolves.toBe("updated");
    expect(registered).toHaveLength(1);
    expect(registered[0]?.excludeMatches).toContain("*://bank.example/*");
  });

  it("unregisters when the switch is turned off", async () => {
    await reconcilePageHooks({});
    await expect(reconcilePageHooks({ pageHooksEnabled: false })).resolves.toBe(
      "unregistered",
    );
    expect(registered).toEqual([]);
  });

  it("reads the stored settings when none are passed", async () => {
    storedSettings = { pageHooksEnabled: false };
    await expect(reconcilePageHooks()).resolves.toBe("unchanged");
    expect(register).not.toHaveBeenCalled();
  });

  it("does not register the bridge when the settings cannot be read", async () => {
    failNextRead = true;
    await expect(reconcilePageHooks()).resolves.toBe("unchanged");
    expect(register).not.toHaveBeenCalled();
  });

  it("removes a registered bridge when the settings cannot be read", async () => {
    await reconcilePageHooks({});
    failNextRead = true;
    await expect(reconcilePageHooks()).resolves.toBe("unregistered");
  });

  it("reports a failed registration instead of throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    register.mockRejectedValueOnce(new Error("Invalid match pattern"));
    await expect(reconcilePageHooks({})).resolves.toBe("failed");
  });
});

describe("watchPageHookSettings", () => {
  async function settle() {
    await reconcilePageHooks(undefined);
  }

  it("reconciles on start and when the switch or the list changes, not on other settings", async () => {
    watchPageHookSettings();
    await settle();
    expect(registered).toHaveLength(1);

    const change = (oldValue: unknown, newValue: unknown) => {
      storedSettings = newValue;
      for (const listener of changeListeners) {
        listener({ [STORAGE_KEYS.SETTINGS]: { oldValue, newValue } }, "local");
      }
    };

    register.mockClear();
    unregister.mockClear();
    change({ theme: "dark" }, { theme: "light" });
    await settle();
    expect(unregister).not.toHaveBeenCalled();

    change({}, { pageHooksEnabled: false });
    await settle();
    expect(registered).toEqual([]);
  });
});
