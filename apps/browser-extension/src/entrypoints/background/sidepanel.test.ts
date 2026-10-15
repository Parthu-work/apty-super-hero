import { afterEach, describe, expect, it, vi } from "vitest";
import { registerSidepanelActionClick } from "./sidepanel";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerSidepanelActionClick", () => {
  it("catches a side panel that fails to open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let onClicked: ((tab: { id?: number }) => void) | undefined;
    const open = vi.fn().mockRejectedValue(new Error("No active side panel"));
    vi.stubGlobal("chrome", {
      action: {
        onClicked: {
          addListener: (fn: typeof onClicked) => {
            onClicked = fn;
          },
        },
      },
      sidePanel: { open },
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);

    registerSidepanelActionClick();
    onClicked?.({ id: 4 });
    await new Promise((r) => setTimeout(r, 10));

    process.off("unhandledRejection", unhandled);
    expect(open).toHaveBeenCalledWith({ tabId: 4 });
    expect(unhandled).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain("side_panel_open_failed");
    vi.unstubAllGlobals();
  });
});
