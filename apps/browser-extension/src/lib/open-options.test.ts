import { beforeEach, describe, expect, it, vi } from "vitest";
import { openOptions, optionsUrl } from "./open-options";

const BASE = "chrome-extension://agent/src/entrypoints/options/index.html";

beforeEach(() => {
  (globalThis as any).chrome = {
    runtime: {
      getURL: (path: string) => `chrome-extension://agent/${path}`,
      sendMessage: vi.fn().mockResolvedValue(true),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    windows: { update: vi.fn().mockResolvedValue({}) },
  };
});

describe("optionsUrl", () => {
  it("opens the tab that holds a section", () => {
    expect(optionsUrl({ section: "apty-client" })).toBe(
      `${BASE}?tab=connection#apty-client`,
    );
    expect(optionsUrl({ section: "approvals" })).toBe(
      `${BASE}?tab=general#approvals`,
    );
    expect(optionsUrl({ tab: "ai" })).toBe(`${BASE}?tab=ai`);
    expect(optionsUrl()).toBe(BASE);
  });
});

describe("openOptions", () => {
  it("navigates an open Options tab in place, without reloading it", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, windowId: 9, url: "https://example.com" },
      { id: 7, windowId: 3, url: `${BASE}?tab=general` },
    ]);

    await openOptions({ section: "ai-provider" });

    expect(chrome.tabs.update).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "apty-options-navigate",
      tab: "ai",
      section: "ai-provider",
    });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("loads the URL when the open tab can't take the message", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 7, windowId: 3, url: `${BASE}?tab=general` },
    ]);
    (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Receiving end does not exist."),
    );

    await openOptions({ section: "apty-client" });

    expect(chrome.tabs.update).toHaveBeenLastCalledWith(7, {
      url: `${BASE}?tab=connection#apty-client`,
    });
  });

  it("opens a new tab otherwise", async () => {
    await openOptions({ tab: "connection" });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `${BASE}?tab=connection`,
    });
  });
});
