import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime", () => ({
  seedAptyIntegrationConfigDefaults: vi.fn(),
}));

import { SETTINGS_VERSION, STORAGE_KEYS } from "@apty/agent-core";
import { registerInstallHandler } from "./lifecycle";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("registerInstallHandler", () => {
  it("catches an options page that fails to open on install", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let onInstalled: ((details: { reason: string }) => void) | undefined;
    const openOptionsPage = vi.fn().mockRejectedValue(new Error("no window"));
    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: {
          addListener: (fn: typeof onInstalled) => {
            onInstalled = fn;
          },
        },
        openOptionsPage,
        getManifest: () => ({ version: "0.1.0" }),
      },
    });

    registerInstallHandler();
    onInstalled?.({ reason: "install" });
    await new Promise((r) => setTimeout(r, 10));

    expect(openOptionsPage).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).toContain(
      "options_page_open_failed",
    );
  });

  /** A chrome stub whose local storage area is `store`; returns the update trigger. */
  function stubUpdate(store: Record<string, unknown>) {
    let onInstalled: ((details: { reason: string }) => void) | undefined;
    const keysOf = (keys: string | string[]) =>
      Array.isArray(keys) ? keys : [keys];
    const set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, structuredClone(items));
    });
    vi.stubGlobal("chrome", {
      runtime: {
        onInstalled: {
          addListener: (fn: typeof onInstalled) => {
            onInstalled = fn;
          },
        },
        getManifest: () => ({ version: "0.1.0" }),
      },
      storage: {
        local: {
          get: vi.fn(async (keys: string | string[]) =>
            Object.fromEntries(
              keysOf(keys)
                .filter((key) => key in store)
                .map((key) => [key, structuredClone(store[key])]),
            ),
          ),
          set,
          remove: vi.fn(async (keys: string | string[]) => {
            for (const key of keysOf(keys)) delete store[key];
          }),
        },
      },
    });
    registerInstallHandler();
    return { update: () => onInstalled?.({ reason: "update" }), set };
  }

  it("brings stored settings up to the current schema on update", async () => {
    const store: Record<string, unknown> = {
      [STORAGE_KEYS.SETTINGS]: { aiToken: "kept", redactionMode: "standard" },
    };
    const { update, set } = stubUpdate(store);

    update();
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());

    expect(store[STORAGE_KEYS.SETTINGS]).toEqual({
      aiToken: "kept",
      redactionMode: "standard",
      settingsVersion: SETTINGS_VERSION,
    });

    update();
    await new Promise((r) => setTimeout(r, 10));
    expect(set).toHaveBeenCalledOnce();
  });

  it("moves settings and grants from their AIPex names on update, then versions the settings", async () => {
    const grants = [{ tool: "click", origin: "https://a.example" }];
    const store: Record<string, unknown> = {
      aipex_settings: { aiToken: "kept" },
      aipex_risky_origin_grants: grants,
    };
    const { update } = stubUpdate(store);

    update();
    await vi.waitFor(() =>
      expect(store[STORAGE_KEYS.SETTINGS]).toMatchObject({
        settingsVersion: SETTINGS_VERSION,
      }),
    );

    expect(store).toEqual({
      [STORAGE_KEYS.SETTINGS]: {
        aiToken: "kept",
        settingsVersion: SETTINGS_VERSION,
      },
      [STORAGE_KEYS.RISKY_ORIGIN_GRANTS]: grants,
    });
  });
});
