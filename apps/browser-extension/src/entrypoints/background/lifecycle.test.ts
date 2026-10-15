import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime", () => ({
  seedAptyIntegrationConfigDefaults: vi.fn(),
}));

import { SETTINGS_VERSION } from "@apty/agent-core";
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

  it("brings stored settings up to the current schema on update", async () => {
    let onInstalled: ((details: { reason: string }) => void) | undefined;
    const store: Record<string, unknown> = {
      aipex_settings: { aiToken: "kept", redactionMode: "standard" },
    };
    const set = vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
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
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set,
        },
      },
    });

    registerInstallHandler();
    onInstalled?.({ reason: "update" });
    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());

    expect(store.aipex_settings).toEqual({
      aiToken: "kept",
      redactionMode: "standard",
      settingsVersion: SETTINGS_VERSION,
    });

    onInstalled?.({ reason: "update" });
    await new Promise((r) => setTimeout(r, 10));
    expect(set).toHaveBeenCalledOnce();
  });
});
