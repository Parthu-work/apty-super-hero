import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveTab, resolveDiagnosticTab } from "./tab-utils";

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
  it("falls back to the active tab when no run context is provided", async () => {
    mockTabsQuery.mockResolvedValue([activeTab(12)]);

    const tab = await resolveDiagnosticTab(undefined);

    expect(tab).toEqual(activeTab(12));
    expect(mockTabsGet).not.toHaveBeenCalled();
  });

  it("falls back to the active tab when the run context has no bound tabId", async () => {
    mockTabsQuery.mockResolvedValue([activeTab(12)]);

    const tab = await resolveDiagnosticTab({
      context: { conversationId: "conv-1", tabId: null },
    });

    expect(tab).toEqual(activeTab(12));
    expect(mockTabsGet).not.toHaveBeenCalled();
  });

  it("targets the conversation's bound tab instead of whatever is active — the core isolation guarantee", async () => {
    // The bound tab (27) is NOT the currently-focused tab (12) — this is
    // exactly the cross-conversation-evidence-leak scenario the mandatory
    // isolation spec calls out: a diagnostic tool call for a conversation
    // bound to tab 27 must never silently read from tab 12 just because
    // the user happened to be looking at it when the tool ran.
    mockTabsQuery.mockResolvedValue([activeTab(12)]);
    mockTabsGet.mockResolvedValue(activeTab(27));

    const tab = await resolveDiagnosticTab({
      context: { conversationId: "conv-1", tabId: 27 },
    });

    expect(tab).toEqual(activeTab(27));
    expect(mockTabsGet).toHaveBeenCalledWith(27);
    expect(mockTabsQuery).not.toHaveBeenCalled();
  });

  it("falls back to the active tab when the bound tab has been closed", async () => {
    mockTabsQuery.mockResolvedValue([activeTab(12)]);
    mockTabsGet.mockRejectedValue(new Error("No tab with id: 27"));

    const tab = await resolveDiagnosticTab({
      context: { conversationId: "conv-1", tabId: 27 },
    });

    expect(tab).toEqual(activeTab(12));
  });
});
