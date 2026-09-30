import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTabsQuery = vi.fn();
const mockTabsGet = vi.fn();
const mockExecuteScript = vi.fn();
const mockGetManifest = vi.fn();

(global as any).chrome = {
  tabs: {
    query: mockTabsQuery,
    get: mockTabsGet,
  },
  scripting: {
    executeScript: mockExecuteScript,
  },
  runtime: {
    getManifest: mockGetManifest,
  },
};

// Import after the chrome mock is installed, and after the (unused in this
// test) apty/index.js provider exports have something to resolve to.
import { getEvidence } from "../apty/evidence-store";
import { getAptyPageLogsTool } from "./apty";

function tab(id: number, url = `https://example.com/tab-${id}`) {
  return { id, active: true, url };
}

function frameResult(
  frameId: number,
  entries: unknown[],
  url = "https://example.com/",
) {
  return { frameId, result: { entries, url } };
}

beforeEach(() => {
  mockTabsQuery.mockReset();
  mockTabsGet.mockReset();
  mockExecuteScript.mockReset();
  mockGetManifest.mockReset();
  mockGetManifest.mockReturnValue({
    content_scripts: [
      { world: "MAIN", js: ["content-scripts/console-bridge.js"] },
    ],
  });
});

describe("getAptyPageLogsTool — conversation/tab isolation", () => {
  it("reads console logs from the conversation's bound tab, not whichever tab is focused", async () => {
    // The user is currently focused on tab 12, but this tool call belongs
    // to a conversation bound to tab 27 — evidence must come from 27.
    mockTabsQuery.mockResolvedValue([tab(12)]);
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript.mockResolvedValue([frameResult(0, [])]);

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    );

    expect(mockTabsGet).toHaveBeenCalledWith(27);
    expect(mockExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 27, allFrames: true },
        world: "MAIN",
      }),
    );
  });

  it("never falls back to the active tab when no conversation context is bound — returns no_bound_tab instead", async () => {
    mockTabsQuery.mockResolvedValue([tab(12)]);

    const result = (await getAptyPageLogsTool.invoke(
      {} as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    )) as any;

    expect(mockTabsQuery).not.toHaveBeenCalled();
    expect(mockExecuteScript).not.toHaveBeenCalled();
    expect(result.available).toBe(false);
    expect(result.status.code).toBe("no_bound_tab");
    expect(result.entries).toEqual([]);
  });

  it("reports bound_tab_closed (not the active tab) when the conversation's bound tab has been closed", async () => {
    mockTabsQuery.mockResolvedValue([tab(12)]);
    mockTabsGet.mockRejectedValue(new Error("No tab with id: 27"));

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    const result = (await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    )) as any;

    expect(result.available).toBe(false);
    expect(result.status.code).toBe("bound_tab_closed");
    expect(result.entries).toEqual([]);
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("reports restricted_page for an internal page without attempting script injection", async () => {
    mockTabsGet.mockResolvedValue(tab(27, "chrome://extensions"));

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    const result = (await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    )) as any;

    expect(result.available).toBe(false);
    expect(result.status.code).toBe("restricted_page");
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("records warn/error-level entries as evidence for this conversation, but not routine log entries", async () => {
    mockTabsQuery.mockResolvedValue([tab(12)]);
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript.mockResolvedValue([
      frameResult(0, [
        {
          seq: 1,
          level: "log",
          message: "routine",
          timestamp: 1,
          source: "console",
        },
        {
          seq: 2,
          level: "error",
          message: "boom",
          timestamp: 2,
          source: "console",
        },
        {
          seq: 3,
          level: "warn",
          message: "careful",
          timestamp: 3,
          source: "console",
        },
      ]),
    ]);

    const runContext = {
      context: { conversationId: "conv-page-logs", tabId: 27 },
    };
    await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    );

    const evidence = getEvidence("conv-page-logs");
    expect(evidence).toHaveLength(2);
    expect(evidence.map((e) => e.type).sort()).toEqual([
      "console-error",
      "console-warn",
    ]);
    expect(evidence.every((e) => e.tabId === 27)).toBe(true);
  });

  it("classifies each returned entry and summarizes category counts", async () => {
    mockTabsQuery.mockResolvedValue([tab(12)]);
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript.mockResolvedValue([
      frameResult(0, [
        {
          seq: 1,
          level: "error",
          message:
            "Access to fetch has been blocked by CORS policy: no Access-Control-Allow-Origin header",
          timestamp: 1,
          source: "console",
        },
        {
          seq: 2,
          level: "error",
          message: "TypeError: Cannot read properties of undefined",
          timestamp: 2,
          source: "window-error",
        },
      ]),
    ]);

    const runContext = {
      context: { conversationId: "conv-classify", tabId: 27 },
    };
    const result = (await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    )) as any;

    expect(result.trust).toBe("untrusted");
    expect(result.entries.map((e: any) => e.category)).toEqual([
      "js-exception",
      "cors-error",
    ]);
    expect(result.categoryCounts).toEqual({
      "js-exception": 1,
      "cors-error": 1,
    });
  });

  it("merges and time-orders entries from every frame, tagging each with its frameId", async () => {
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript.mockResolvedValue([
      frameResult(
        0,
        [
          {
            seq: 1,
            level: "log",
            message: "top frame",
            timestamp: 10,
            source: "console",
          },
        ],
        "https://example.com/",
      ),
      frameResult(
        7,
        [
          {
            seq: 1,
            level: "log",
            message: "iframe",
            timestamp: 5,
            source: "console",
          },
        ],
        "https://embedded.example.com/",
      ),
    ]);

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    const result = (await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    )) as any;

    // Newest-first: iframe (ts 5) sorts before the top frame (ts 10) only
    // once reversed — ascending merge order is iframe(5), top(10), so
    // newest-first output is top(10), iframe(5).
    expect(result.entries.map((e: any) => e.message)).toEqual([
      "top frame",
      "iframe",
    ]);
    expect(
      result.entries.find((e: any) => e.message === "iframe").frameId,
    ).toBe(7);
    expect(
      result.entries.find((e: any) => e.message === "iframe").frameUrl,
    ).toBe("https://embedded.example.com/");
    expect(result.coverage.framesRead).toBe(2);
  });

  it("only includes the top frame when frames: 'top' is requested", async () => {
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript.mockResolvedValue([
      frameResult(0, [
        {
          seq: 1,
          level: "log",
          message: "top frame",
          timestamp: 10,
          source: "console",
        },
      ]),
      frameResult(7, [
        {
          seq: 1,
          level: "log",
          message: "iframe",
          timestamp: 5,
          source: "console",
        },
      ]),
    ]);

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    const result = (await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log", frames: "top" }),
    )) as any;

    expect(result.entries.map((e: any) => e.message)).toEqual(["top frame"]);
  });

  it("injects the bridge on demand into a frame where it isn't installed yet, and tags those entries coverage: from-injection", async () => {
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript
      // Initial read: frame 0 has the bridge, frame 3 doesn't (result undefined).
      .mockResolvedValueOnce([
        frameResult(0, []),
        { frameId: 3, result: undefined },
      ])
      // Injecting the bridge's built content-script files into frame 3.
      .mockResolvedValueOnce([{ frameId: 3, result: undefined }])
      // Re-read after injection succeeds.
      .mockResolvedValueOnce([
        frameResult(
          3,
          [
            {
              seq: 1,
              level: "log",
              message: "late iframe",
              timestamp: 1,
              source: "console",
            },
          ],
          "https://embedded.example.com/",
        ),
      ]);

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    const result = (await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    )) as any;

    expect(mockExecuteScript).toHaveBeenCalledTimes(3);
    expect(mockExecuteScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        target: { tabId: 27, frameIds: [3] },
        world: "MAIN",
        files: ["content-scripts/console-bridge.js"],
      }),
    );
    expect(result.entries).toEqual([
      expect.objectContaining({
        message: "late iframe",
        frameId: 3,
        coverage: "from-injection",
      }),
    ]);
    expect(result.coverage.injectedFrames).toBe(1);
  });

  it("reports no_permission when script injection fails for a reason other than a restricted page", async () => {
    mockTabsGet.mockResolvedValue(tab(27));
    mockExecuteScript.mockRejectedValue(new Error("Some other failure"));

    const runContext = { context: { conversationId: "conv-1", tabId: 27 } };
    const result = (await getAptyPageLogsTool.invoke(
      runContext as any,
      JSON.stringify({ limit: 100, minLevel: "log" }),
    )) as any;

    expect(result.available).toBe(false);
    expect(result.status.code).toBe("no_permission");
  });
});
