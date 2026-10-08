import { beforeEach, describe, expect, it, vi } from "vitest";
import { openOptions, optionsUrl } from "./open-options";

const BASE = "chrome-extension://agent/src/entrypoints/options/index.html";

beforeEach(() => {
  (globalThis as any).chrome = {
    runtime: { getURL: (path: string) => `chrome-extension://agent/${path}` },
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
  it("reuses an Options tab that is already open", async () => {
    (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, windowId: 9, url: "https://example.com" },
      { id: 7, windowId: 3, url: `${BASE}?tab=general` },
    ]);

    await openOptions({ section: "ai-provider" });

    expect(chrome.tabs.update).toHaveBeenCalledWith(7, {
      url: `${BASE}?tab=ai#ai-provider`,
      active: true,
    });
    expect(chrome.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it("opens a new tab otherwise", async () => {
    await openOptions({ tab: "connection" });
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: `${BASE}?tab=connection`,
    });
  });
});
