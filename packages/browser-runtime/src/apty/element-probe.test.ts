import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.fn();
const mockGetAllFrames = vi.fn();
const mockGetTab = vi.fn();
const runtime: { lastError?: { message: string } } & Record<string, unknown> = {
  lastError: undefined,
  getManifest: () => ({ content_scripts: [] }),
};

(globalThis as { chrome?: unknown }).chrome = {
  runtime,
  tabs: { sendMessage: mockSendMessage, get: mockGetTab },
  scripting: { executeScript: vi.fn(async () => []) },
  webNavigation: { getAllFrames: mockGetAllFrames },
};

import { probeStoredElement, tabElementProbeOf } from "./element-probe";

const TARGET = {
  language: "css" as const,
  selector: "button.save",
  shadowRoots: [],
};

const test = (matchCount: number) => ({
  invalid: false,
  matchCount,
  renderedCount: matchCount,
  brokenHostIndex: null,
  shadowMatches: 0,
  chosen: matchCount ? { rendered: true, inViewport: true } : null,
});

function frames(
  ...list: Array<{ id: number; parent: number; url: string; error?: boolean }>
) {
  mockGetAllFrames.mockResolvedValue(
    list.map((f) => ({
      frameId: f.id,
      parentFrameId: f.parent,
      url: f.url,
      errorOccurred: f.error ?? false,
    })),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("probeStoredElement", () => {
  it("asks every frame, keeps each one's place and drops the URLs", async () => {
    frames(
      { id: 0, parent: -1, url: "https://app.example/orders?tenant=7" },
      { id: 4, parent: 0, url: "https://app.example/frame" },
      { id: 9, parent: 0, url: "https://other.example/widget" },
      { id: 12, parent: 0, url: "about:blank" },
    );
    mockSendMessage.mockImplementation(
      (_tab, message, { frameId }, callback) => {
        expect(message).toEqual({
          request: "test-apty-element",
          target: TARGET,
        });
        if (frameId === 9) {
          runtime.lastError = { message: "Timed out" };
          callback(undefined);
          runtime.lastError = undefined;
          return;
        }
        callback({ success: true, data: test(frameId === 4 ? 1 : 0) });
      },
    );

    const probe = await probeStoredElement(1, TARGET);

    expect(probe).toEqual({
      ok: true,
      frames: [
        { depth: 0, sameOriginAsTop: true, answered: true, test: test(0) },
        { depth: 1, sameOriginAsTop: true, answered: true, test: test(1) },
        { depth: 1, sameOriginAsTop: false, answered: false },
      ],
    });
    expect(JSON.stringify(probe)).not.toContain("example");
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
  });

  it("does not message a frame the browser reports as failed", async () => {
    frames(
      { id: 0, parent: -1, url: "https://app.example/" },
      { id: 3, parent: 0, url: "https://app.example/broken", error: true },
    );
    mockSendMessage.mockImplementation((_t, _m, _o, callback) =>
      callback({ success: true, data: test(1) }),
    );

    const probe = await probeStoredElement(1, TARGET);

    expect(probe.ok && probe.frames[1]).toEqual({
      depth: 1,
      sameOriginAsTop: true,
      answered: false,
    });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it("names a tab whose frames cannot be listed", async () => {
    mockGetAllFrames.mockRejectedValue(new Error("No tab with id: 1"));

    await expect(probeStoredElement(1, TARGET)).resolves.toEqual({
      ok: false,
      reason: "frames-unreadable",
    });
  });
});

describe("tabElementProbeOf", () => {
  it("probes only a web page in the conversation's tab", async () => {
    mockGetTab.mockResolvedValueOnce({ url: "chrome://settings" });
    await expect(tabElementProbeOf({ tabId: 1 })(TARGET)).resolves.toEqual({
      ok: false,
      reason: "no-page",
    });
    await expect(tabElementProbeOf({})(TARGET)).resolves.toEqual({
      ok: false,
      reason: "no-page",
    });
    mockGetTab.mockRejectedValueOnce(new Error("No tab"));
    await expect(tabElementProbeOf({ tabId: 1 })(TARGET)).resolves.toEqual({
      ok: false,
      reason: "no-page",
    });
  });

  it("probes the tab's frames when it shows a web page", async () => {
    mockGetTab.mockResolvedValue({ url: "https://app.example/" });
    frames({ id: 0, parent: -1, url: "https://app.example/" });
    mockSendMessage.mockImplementation((_t, _m, _o, callback) =>
      callback({ success: true, data: test(1) }),
    );

    const probe = await tabElementProbeOf({ tabId: 1 })(TARGET);

    expect(probe).toMatchObject({ ok: true, frames: [{ answered: true }] });
  });
});
