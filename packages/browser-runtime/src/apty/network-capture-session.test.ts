import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEvidence } from "./evidence-store";
import { startInvestigation } from "./investigation-session";

const mockSendCommand = vi.hoisted(() => vi.fn());
const mockSafeAttachDebugger = vi.hoisted(() => vi.fn());
const mockSafeDetachDebugger = vi.hoisted(() => vi.fn());
const mockAddListener = vi.hoisted(() => vi.fn());
const mockRemoveListener = vi.hoisted(() => vi.fn());

vi.mock("../automation/cdp-commander.js", () => ({
  CdpCommander: class {
    sendCommand = mockSendCommand;
  },
}));

vi.mock("../automation/debugger-manager.js", () => ({
  debuggerManager: {
    safeAttachDebugger: mockSafeAttachDebugger,
    safeDetachDebugger: mockSafeDetachDebugger,
  },
}));

(global as any).chrome = {
  debugger: {
    onEvent: {
      addListener: mockAddListener,
      removeListener: mockRemoveListener,
    },
  },
};

import {
  getActiveCaptureCount,
  getNetworkCaptureStatus,
  startNetworkCapture,
  stopNetworkCapture,
} from "./network-capture-session";

const TAB_ID = 7;

/** Fires the currently-registered capture listener as if the event came from `TAB_ID`. */
function fireEvent(method: string, params: unknown) {
  for (const call of mockAddListener.mock.calls) {
    const listener = call[0] as (
      source: { tabId: number },
      method: string,
      params?: object,
    ) => void;
    listener({ tabId: TAB_ID }, method, params as object);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSafeAttachDebugger.mockResolvedValue(true);
  mockSafeDetachDebugger.mockResolvedValue(undefined);
  mockSendCommand.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("network-capture-session — start/stop lifecycle", () => {
  it("starts a capture, attaches the debugger, and enables Network domain", async () => {
    const result = await startNetworkCapture("conv-a", TAB_ID);

    expect(result.started).toBe(true);
    expect(result.session?.status).toBe("capturing");
    expect(result.session?.tabId).toBe(TAB_ID);
    expect(mockSafeAttachDebugger).toHaveBeenCalledWith(TAB_ID);
    expect(mockSendCommand).toHaveBeenCalledWith("Network.enable", {});
    expect(getActiveCaptureCount()).toBe(1);

    await stopNetworkCapture("conv-a");
  });

  it("refuses to start a second capture for the same conversation while one is running", async () => {
    await startNetworkCapture("conv-dup", TAB_ID);
    const second = await startNetworkCapture("conv-dup", TAB_ID);

    expect(second.started).toBe(false);
    expect(second.error).toMatch(/already running/);
    expect(getActiveCaptureCount()).toBe(1);

    await stopNetworkCapture("conv-dup");
  });

  it("reports failure to start when the debugger can't attach", async () => {
    mockSafeAttachDebugger.mockResolvedValueOnce(false);
    const result = await startNetworkCapture("conv-fail", TAB_ID);

    expect(result.started).toBe(false);
    expect(result.error).toMatch(/attach/i);
    expect(getActiveCaptureCount()).toBe(0);
  });

  it("accumulates requests across the capture and returns them all on stop", async () => {
    await startNetworkCapture("conv-collect", TAB_ID);

    fireEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/ok", method: "GET" },
      type: "XHR",
      initiator: { type: "script" },
    });
    fireEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, statusText: "OK" },
    });
    fireEvent("Network.requestWillBeSent", {
      requestId: "req-2",
      request: { url: "https://example.com/broken", method: "POST" },
    });
    fireEvent("Network.loadingFailed", {
      requestId: "req-2",
      errorText: "net::ERR_FAILED",
    });

    const result = await stopNetworkCapture("conv-collect");

    expect(result.stopped).toBe(true);
    expect(result.requests).toHaveLength(2);
    expect(result.session?.status).toBe("stopped");
    expect(result.session?.requestCount).toBe(2);
    expect(mockSendCommand).toHaveBeenCalledWith("Network.disable", {});
    expect(mockSafeDetachDebugger).toHaveBeenCalledWith(TAB_ID, true);

    const ok = result.requests?.find((r) => r.requestId === "req-1");
    expect(ok?.resourceType).toBe("XHR");
    expect(ok?.initiatorType).toBe("script");
  });

  it("filters to only failing requests when onlyErrors is set, while still recording the full failure set as evidence", async () => {
    await startNetworkCapture("conv-errors", TAB_ID);
    fireEvent("Network.requestWillBeSent", {
      requestId: "req-ok",
      request: { url: "https://example.com/ok", method: "GET" },
    });
    fireEvent("Network.responseReceived", {
      requestId: "req-ok",
      response: { status: 200 },
    });
    fireEvent("Network.requestWillBeSent", {
      requestId: "req-500",
      request: { url: "https://example.com/broken", method: "GET" },
    });
    fireEvent("Network.responseReceived", {
      requestId: "req-500",
      response: { status: 500, statusText: "Internal Server Error" },
    });

    const result = await stopNetworkCapture("conv-errors", {
      onlyErrors: true,
    });

    expect(result.requests).toHaveLength(1);
    expect(result.requests?.[0]?.requestId).toBe("req-500");

    const evidence = getEvidence("conv-errors");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.type).toBe("network-http-error");
    expect(evidence[0]?.requestId).toBe("req-500");
  });

  it("tags the capture session with the active investigation id, and carries it onto recorded evidence", async () => {
    const investigation = startInvestigation({
      conversationId: "conv-with-investigation",
      tabId: TAB_ID,
      userProblem: "Widget not loading",
    });

    const started = await startNetworkCapture(
      "conv-with-investigation",
      TAB_ID,
    );
    expect(started.session?.investigationId).toBe(investigation.id);

    fireEvent("Network.requestWillBeSent", {
      requestId: "req-fail",
      request: { url: "https://example.com/broken", method: "GET" },
    });
    fireEvent("Network.loadingFailed", {
      requestId: "req-fail",
      errorText: "net::ERR_FAILED",
    });

    await stopNetworkCapture("conv-with-investigation");
    const evidence = getEvidence("conv-with-investigation");
    expect(evidence[0]?.correlationId).toBe(investigation.id);
  });

  it("returns an error when stopping with no active capture", async () => {
    const result = await stopNetworkCapture("conv-never-started");
    expect(result.stopped).toBe(false);
    expect(result.error).toMatch(/no network capture/i);
  });

  it("isolates captures between conversations on the same tab", async () => {
    await startNetworkCapture("conv-x", TAB_ID);
    await startNetworkCapture("conv-y", TAB_ID);

    fireEvent("Network.requestWillBeSent", {
      requestId: "shared-req",
      request: { url: "https://example.com/shared", method: "GET" },
    });

    const [xResult, yResult] = await Promise.all([
      stopNetworkCapture("conv-x"),
      stopNetworkCapture("conv-y"),
    ]);

    expect(xResult.requests).toHaveLength(1);
    expect(yResult.requests).toHaveLength(1);
  });
});

describe("network-capture-session — status", () => {
  it("reports no active capture before start and after stop", async () => {
    expect(getNetworkCaptureStatus("conv-status")).toBeUndefined();
    await startNetworkCapture("conv-status", TAB_ID);
    expect(getNetworkCaptureStatus("conv-status")?.status).toBe("capturing");
    await stopNetworkCapture("conv-status");
    expect(getNetworkCaptureStatus("conv-status")).toBeUndefined();
  });

  it("reflects the running request count without stopping the capture", async () => {
    await startNetworkCapture("conv-count", TAB_ID);
    fireEvent("Network.requestWillBeSent", {
      requestId: "req-a",
      request: { url: "https://example.com/a", method: "GET" },
    });
    fireEvent("Network.requestWillBeSent", {
      requestId: "req-b",
      request: { url: "https://example.com/b", method: "GET" },
    });

    expect(getNetworkCaptureStatus("conv-count")?.requestCount).toBe(2);
    await stopNetworkCapture("conv-count");
  });
});

describe("network-capture-session — heartbeat", () => {
  it("periodically re-attaches the debugger to survive the 30s idle auto-detach", async () => {
    vi.useFakeTimers();
    await startNetworkCapture("conv-heartbeat", TAB_ID);
    mockSafeAttachDebugger.mockClear();

    await vi.advanceTimersByTimeAsync(15000);
    expect(mockSafeAttachDebugger).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15000);
    expect(mockSafeAttachDebugger).toHaveBeenCalledTimes(2);

    await stopNetworkCapture("conv-heartbeat");
    mockSafeAttachDebugger.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    expect(mockSafeAttachDebugger).not.toHaveBeenCalled();
  });
});
