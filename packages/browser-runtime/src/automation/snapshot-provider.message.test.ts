import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../runtime/automation-mode", () => ({
  getAutomationMode: vi.fn().mockResolvedValue("background"),
}));

import { createSnapshot } from "./snapshot-provider";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a background-mode snapshot", () => {
  it("asks the page's top frame with the apty: message", async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValue({ success: false, error: "not ready" });
    vi.stubGlobal("chrome", { tabs: { sendMessage } });

    await expect(createSnapshot(7)).rejects.toThrow("not ready");
    expect(sendMessage).toHaveBeenCalledWith(
      7,
      { type: "apty:collect-dom-snapshot", options: undefined },
      { frameId: 0 },
    );
  });
});
