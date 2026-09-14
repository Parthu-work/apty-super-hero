import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTabsQuery = vi.fn();
const mockTabsGet = vi.fn();
const mockExecuteScript = vi.fn();

(global as any).chrome = {
  tabs: {
    query: mockTabsQuery,
    get: mockTabsGet,
  },
  scripting: {
    executeScript: mockExecuteScript,
  },
};

// Import after the chrome mock is installed, and after the (unused in this
// test) apty/index.js provider exports have something to resolve to.
import { getAptyPageLogsTool } from "./apty";

function tab(id: number) {
  return { id, active: true, url: `https://example.com/tab-${id}` };
}

beforeEach(() => {
  mockTabsQuery.mockReset();
  mockTabsGet.mockReset();
  mockExecuteScript.mockReset();
});

describe("getAptyPageLogsTool — conversation/tab isolation", () => {
  it("reads console logs from the conversation's bound tab, not whichever tab is focused", async () => {
    // The user is currently focused on tab 12, but this tool call belongs
    // to a conversation bound to tab 27 — evidence must come from 27.
    mockTabsQuery.mockResolvedValue([tab(12)]);
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript.mockResolvedValue([{ result: [] }]);

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    );

    expect(mockTabsGet).toHaveBeenCalledWith(27);
    expect(mockExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 27 } }),
    );
  });

  it("falls back to the active tab when no conversation context is bound", async () => {
    mockTabsQuery.mockResolvedValue([tab(12)]);
    mockExecuteScript.mockResolvedValue([{ result: [] }]);

    await getAptyPageLogsTool.invoke(
      {} as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    );

    expect(mockExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 12 } }),
    );
  });
});
