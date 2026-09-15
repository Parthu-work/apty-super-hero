import type { DomHealthSnapshot } from "@aipexstudio/dom-snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockTabsGet = vi.hoisted(() => vi.fn());

(global as any).chrome = {
  tabs: {
    get: mockTabsGet,
    sendMessage: mockSendMessage,
  },
  runtime: { lastError: undefined as { message?: string } | undefined },
};

import { runDomHealthAudit } from "./dom-health";

const TAB_ID = 42;

function snapshotFixture(
  overrides: Partial<DomHealthSnapshot> = {},
): DomHealthSnapshot {
  return {
    collectedAt: Date.now(),
    url: "https://example.com/app",
    title: "Example",
    counts: {
      totalElements: 10,
      interactiveElements: 2,
      buttons: 1,
      inputs: 1,
      selects: 0,
      textareas: 0,
      links: 0,
      forms: 0,
      contentEditable: 0,
    },
    interactiveElements: [
      { tagName: "button", attributes: { dataAttributes: { testid: "go" } } },
    ],
    iframes: { total: 0, accessible: 0, crossOrigin: 0 },
    shadowDom: { roots: 0, elements: 0 },
    zIndex: { maxZIndex: 0, highZIndexElementCount: 0 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  (global as any).chrome.runtime.lastError = undefined;
  mockTabsGet.mockResolvedValue({ id: TAB_ID, url: "https://example.com/app" });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("runDomHealthAudit", () => {
  it("collects two snapshots a stabilization interval apart and returns a scored result", async () => {
    mockSendMessage.mockImplementation(
      (_tabId: number, _msg: unknown, callback: any) => {
        callback({ success: true, data: snapshotFixture() });
      },
    );

    const promise = runDomHealthAudit(TAB_ID);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.available).toBe(true);
    if (result.available) {
      expect(typeof result.score).toBe("number");
      expect(result.metadata.snapshotsCompared).toBe(2);
    }
    expect(mockSendMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects unsupported browser-internal pages without messaging the content script", async () => {
    mockTabsGet.mockResolvedValue({ id: TAB_ID, url: "chrome://extensions" });

    const result = await runDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("reports an honest error when the tab no longer exists", async () => {
    mockTabsGet.mockRejectedValue(new Error("No tab with id"));

    const result = await runDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
  });

  it("reports the content script's own error when snapshot collection fails", async () => {
    mockSendMessage.mockImplementation(
      (_tabId: number, _msg: unknown, callback: any) => {
        callback({ success: false, error: "Failed to collect DOM snapshot" });
      },
    );

    const result = await runDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.error).toContain("Failed to collect");
    }
  });

  it("reports chrome.runtime.lastError when the content script cannot be reached", async () => {
    mockSendMessage.mockImplementation(
      (_tabId: number, _msg: unknown, callback: any) => {
        (global as any).chrome.runtime.lastError = {
          message: "Could not establish connection",
        };
        callback(undefined);
        (global as any).chrome.runtime.lastError = undefined;
      },
    );

    const result = await runDomHealthAudit(TAB_ID);

    expect(result.available).toBe(false);
    if (!result.available) {
      expect(result.error).toContain("Could not establish connection");
    }
  });

  it("times out if the content script never responds", async () => {
    mockSendMessage.mockImplementation(() => {
      // Never invokes the callback.
    });

    const promise = runDomHealthAudit(TAB_ID);
    await vi.advanceTimersByTimeAsync(9000);
    const result = await promise;

    expect(result.available).toBe(false);
  });
});
