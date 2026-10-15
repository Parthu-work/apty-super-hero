import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@apty/browser-runtime", () => ({
  seedAptyIntegrationConfigDefaults: vi.fn(),
}));

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
});
