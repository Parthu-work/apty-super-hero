import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeTabForMeta,
  describeTabResolutionFailure,
  getActiveTab,
  resolveDiagnosticTab,
} from "./tab-utils";

const mockTabsQuery = vi.fn();
const mockTabsGet = vi.fn();

(global as any).chrome = {
  tabs: {
    query: mockTabsQuery,
    get: mockTabsGet,
  },
};

function activeTab(id: number) {
  return { id, active: true, url: `https://example.com/tab-${id}` };
}

beforeEach(() => {
  mockTabsQuery.mockReset();
  mockTabsGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getActiveTab", () => {
  it("returns the active tab in the current window", async () => {
    mockTabsQuery.mockResolvedValue([activeTab(12)]);
    await expect(getActiveTab()).resolves.toEqual(activeTab(12));
    expect(mockTabsQuery).toHaveBeenCalledWith({
      active: true,
      currentWindow: true,
    });
  });

  it("throws when there is no active tab", async () => {
    mockTabsQuery.mockResolvedValue([]);
    await expect(getActiveTab()).rejects.toThrow("No active tab found");
  });
});

describe("resolveDiagnosticTab", () => {
  it("never silently uses the active tab: no run context at all returns no_bound_tab", async () => {
    mockTabsQuery.mockResolvedValue([activeTab(12)]);

    const result = await resolveDiagnosticTab(undefined);

    expect(result).toEqual({ ok: false, code: "no_bound_tab" });
    expect(mockTabsQuery).not.toHaveBeenCalled();
    expect(mockTabsGet).not.toHaveBeenCalled();
  });

  it("never silently uses the active tab: a run context with no bound tabId returns no_bound_tab", async () => {
    mockTabsQuery.mockResolvedValue([activeTab(12)]);

    const result = await resolveDiagnosticTab({
      context: { conversationId: "conv-1", tabId: null },
    });

    expect(result).toEqual({ ok: false, code: "no_bound_tab" });
    expect(mockTabsQuery).not.toHaveBeenCalled();
  });

  it("targets the conversation's bound tab instead of whatever is active — the core isolation guarantee", async () => {
    // The bound tab (27) is NOT the currently-focused tab (12) — this is
    // exactly the cross-conversation-evidence-leak scenario the mandatory
    // isolation spec calls out: a diagnostic tool call for a conversation
    // bound to tab 27 must never silently read from tab 12 just because
    // the user happened to be looking at it when the tool ran.
    mockTabsQuery.mockResolvedValue([activeTab(12)]);
    mockTabsGet.mockResolvedValue(activeTab(27));

    const result = await resolveDiagnosticTab({
      context: { conversationId: "conv-1", tabId: 27 },
    });

    expect(result).toEqual({ ok: true, tab: activeTab(27) });
    expect(mockTabsGet).toHaveBeenCalledWith(27);
    expect(mockTabsQuery).not.toHaveBeenCalled();
  });

  it("returns bound_tab_closed (never the active tab) when the bound tab has been closed", async () => {
    mockTabsQuery.mockResolvedValue([activeTab(12)]);
    mockTabsGet.mockRejectedValue(new Error("No tab with id: 27"));

    const result = await resolveDiagnosticTab({
      context: { conversationId: "conv-1", tabId: 27 },
    });

    expect(result).toEqual({ ok: false, code: "bound_tab_closed" });
    expect(mockTabsQuery).not.toHaveBeenCalled();
  });
});

describe("describeTabResolutionFailure", () => {
  it("describes no_bound_tab with an actionable next step", () => {
    const described = describeTabResolutionFailure("no_bound_tab");
    expect(described.code).toBe("no_bound_tab");
    expect(described.nextSteps.length).toBeGreaterThan(0);
  });

  it("describes bound_tab_closed with an actionable next step", () => {
    const described = describeTabResolutionFailure("bound_tab_closed");
    expect(described.code).toBe("bound_tab_closed");
    expect(described.nextSteps.length).toBeGreaterThan(0);
  });
});

describe("describeTabForMeta", () => {
  it("extracts id, origin, and title from a tab", () => {
    expect(
      describeTabForMeta({
        id: 27,
        url: "https://app.example.com/path?query=1",
        title: "Example App",
      } as chrome.tabs.Tab),
    ).toEqual({
      id: 27,
      origin: "https://app.example.com",
      title: "Example App",
    });
  });

  it("handles a tab with no url or title", () => {
    expect(describeTabForMeta({ id: 27 } as chrome.tabs.Tab)).toEqual({
      id: 27,
      origin: null,
      title: null,
    });
  });
});
