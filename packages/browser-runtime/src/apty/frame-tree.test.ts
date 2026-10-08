import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.fn();
const mockExecuteScript = vi.fn();
const mockGetAllFrames = vi.fn();
const runtime: { lastError?: { message: string } } & Record<string, unknown> = {
  lastError: undefined,
  getManifest: () => ({
    content_scripts: [
      { js: ["assets/index.tsx-loader-abc.js"] },
      { js: ["assets/frame-responder.ts-loader-def.js"] },
    ],
  }),
};

(global as any).chrome = {
  runtime,
  tabs: { sendMessage: mockSendMessage },
  scripting: { executeScript: mockExecuteScript },
  webNavigation: { getAllFrames: mockGetAllFrames },
};

import { sendFrameMessage } from "./frame-tree";
import { waitForDomStable } from "./page-navigation";

type Reply = { error: string } | Record<string, unknown>;

/** Queue the replies each `chrome.tabs.sendMessage` call will produce, in order. */
function replies(...queue: Reply[]) {
  mockSendMessage.mockImplementation(
    (
      _tab: number,
      _msg: unknown,
      _opts: unknown,
      cb: (r?: unknown) => void,
    ) => {
      const next = queue.shift() ?? { error: "no reply queued" };
      if (
        "error" in next &&
        typeof next.error === "string" &&
        !("success" in next)
      ) {
        runtime.lastError = { message: next.error };
        cb(undefined);
        runtime.lastError = undefined;
        return;
      }
      cb(next);
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecuteScript.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sendFrameMessage recovery", () => {
  it("injects the responder into a frame with no live receiver and retries once", async () => {
    replies(
      {
        error: "Could not establish connection. Receiving end does not exist.",
      },
      { success: true, data: { pong: true } },
    );

    const result = await sendFrameMessage(4, 9, { request: "dom-health-ping" });

    expect(result).toEqual({ success: true, data: { pong: true } });
    expect(mockExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 4, frameIds: [9] },
      files: ["assets/frame-responder.ts-loader-def.js"],
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not inject for failures other than a missing receiver", async () => {
    replies({ success: false, error: "collector threw" });

    const result = await sendFrameMessage(4, 9, { request: "x" });

    expect(result).toEqual({ success: false, error: "collector threw" });
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it("says so when the frame cannot be scripted", async () => {
    replies({ error: "Receiving end does not exist." });
    mockExecuteScript.mockRejectedValue(
      new Error("Cannot access chrome-error://"),
    );

    const result = await sendFrameMessage(4, 9, { request: "x" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/could not be injected/);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });
});

describe("waitForDomStable", () => {
  it("waits on every loaded frame, not only the top document", async () => {
    mockGetAllFrames.mockResolvedValue([
      {
        frameId: 0,
        parentFrameId: -1,
        url: "https://a.test/",
        errorOccurred: false,
      },
      {
        frameId: 3,
        parentFrameId: 0,
        url: "https://b.test/",
        errorOccurred: false,
      },
      {
        frameId: 5,
        parentFrameId: 0,
        url: "about:blank",
        errorOccurred: false,
      },
    ]);
    replies(
      { success: true, data: { settled: true, elapsedMs: 400 } },
      { success: true, data: { settled: false, elapsedMs: 8000 } },
    );

    const result = await waitForDomStable(1, 400, 8000);

    const frameIds = mockSendMessage.mock.calls.map(
      ([, , opts]) => opts.frameId,
    );
    expect(frameIds.sort()).toEqual([0, 3]);
    expect(result).toEqual({ settled: false, elapsedMs: 8000 });
  });
});
