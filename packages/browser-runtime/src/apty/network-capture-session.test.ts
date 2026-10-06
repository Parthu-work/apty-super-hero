import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { clearEvidence, getEvidence } from "./evidence-store";
import {
  clearInvestigation,
  startInvestigation,
} from "./investigation-session";

const mockSendCommand = vi.hoisted(() => vi.fn());
const mockSafeAttachDebugger = vi.hoisted(() => vi.fn());
const mockSafeDetachDebugger = vi.hoisted(() => vi.fn());
const mockOnEventAddListener = vi.hoisted(() => vi.fn());
const mockOnEventRemoveListener = vi.hoisted(() => vi.fn());
const mockOnRemovedAddListener = vi.hoisted(() => vi.fn());
const mockOnDetachAddListener = vi.hoisted(() => vi.fn());
const mockAlarmsCreate = vi.hoisted(() => vi.fn());
const mockAlarmsClear = vi.hoisted(() => vi.fn());
const mockOnAlarmAddListener = vi.hoisted(() => vi.fn());

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
      addListener: mockOnEventAddListener,
      removeListener: mockOnEventRemoveListener,
    },
    onDetach: { addListener: mockOnDetachAddListener },
  },
  tabs: {
    onRemoved: { addListener: mockOnRemovedAddListener },
  },
  alarms: {
    create: mockAlarmsCreate,
    clear: mockAlarmsClear,
    onAlarm: { addListener: mockOnAlarmAddListener },
  },
};

import {
  __simulateForcedCleanupForTab,
  CAPTURE_KEEPALIVE_ALARM_NAME,
  getActiveCaptureCount,
  getNetworkCaptureStatus,
  MAX_BODY_FETCH_BYTES,
  MAX_CAPTURED_REQUESTS,
  startNetworkCapture,
  stopNetworkCapture,
} from "./network-capture-session";
import { MAX_INLINE_BODY_CHARS } from "./resource-body-utils";

/** Waits for any already-scheduled microtasks (e.g. an in-flight `maybeFetchResponseBody` promise chain) to settle before the test asserts on their result. */
async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const TAB_ID = 42;

/** Fires every event registered via chrome.debugger.onEvent.addListener, as if it came from TAB_ID. */
function fireDebuggerEvent(method: string, params: unknown) {
  for (const call of mockOnEventAddListener.mock.calls) {
    const listener = call[0] as (
      source: { tabId: number },
      method: string,
      params?: object,
    ) => void;
    listener({ tabId: TAB_ID }, method, params as object);
  }
}

/**
 * The forced-cleanup listeners (chrome.tabs.onRemoved / chrome.debugger.onDetach)
 * are registered exactly once, lazily, the first time startNetworkCapture
 * runs — mirroring the real one-time registration in a live service worker.
 * `vi.clearAllMocks()` in beforeEach wipes `.mock.calls` on every mock
 * between tests, which would erase the record of that one-time
 * registration before any later test's fireTabRemoved/fireDebuggerDetach
 * gets a chance to look it up. Capture the actual listener functions once,
 * in beforeAll (before any beforeEach has run), and call them directly
 * from then on instead of re-querying `.mock.calls`.
 */
let onRemovedListener: (tabId: number) => void;
let onDetachListener: (source: { tabId: number }, reason: string) => void;
let onAlarmListener: (alarm: { name: string }) => void;

function fireTabRemoved(tabId: number) {
  onRemovedListener(tabId);
}

function fireDebuggerDetach(tabId: number) {
  onDetachListener({ tabId }, "target_closed");
}

function fireKeepaliveAlarm() {
  onAlarmListener({ name: CAPTURE_KEEPALIVE_ALARM_NAME });
}

beforeAll(async () => {
  mockSafeAttachDebugger.mockResolvedValue(true);
  mockSafeDetachDebugger.mockResolvedValue(undefined);
  mockSendCommand.mockResolvedValue(undefined);
  await startNetworkCapture("conv-warmup", 999);
  onRemovedListener = mockOnRemovedAddListener.mock.calls[0][0];
  onDetachListener = mockOnDetachAddListener.mock.calls[0][0];
  onAlarmListener = mockOnAlarmAddListener.mock.calls[0][0];
  await stopNetworkCapture("conv-warmup");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mockSafeAttachDebugger.mockResolvedValue(true);
  mockSafeDetachDebugger.mockResolvedValue(undefined);
  mockSendCommand.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearEvidence("conv-a");
  clearEvidence("conv-b");
  clearInvestigation("conv-a");
});

describe("network-capture-session — lifecycle", () => {
  it("starts a capture, accumulates requests, and returns them on stop", async () => {
    const started = await startNetworkCapture("conv-a", TAB_ID);
    expect(started.started).toBe(true);
    expect(started.session?.status).toBe("capturing");

    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/api", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, statusText: "OK" },
    });

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.stopped).toBe(true);
    expect(stopped.requests).toHaveLength(1);
    expect(stopped.requests?.[0].status).toBe(200);
    expect(stopped.session?.status).toBe("stopped");
    expect(stopped.session?.truncated).toBe(false);
  });

  it("refuses a second start while one is already running for the same conversation", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    const second = await startNetworkCapture("conv-a", TAB_ID);

    expect(second.started).toBe(false);
    expect(second.error).toMatch(/already running/i);

    await stopNetworkCapture("conv-a");
  });

  it("isolates captures between conversations", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    await startNetworkCapture("conv-b", TAB_ID + 1);

    expect(getActiveCaptureCount()).toBe(2);
    expect(getNetworkCaptureStatus("conv-a")?.tabId).toBe(TAB_ID);
    expect(getNetworkCaptureStatus("conv-b")?.tabId).toBe(TAB_ID + 1);

    await stopNetworkCapture("conv-a");
    await stopNetworkCapture("conv-b");
  });

  it("records only failed/4xx/5xx requests as evidence, tagged with the active investigation", async () => {
    const investigation = startInvestigation({
      conversationId: "conv-a",
      tabId: TAB_ID,
      userProblem: "Widget fails to load",
    });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-ok",
      request: { url: "https://example.com/ok", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-ok",
      response: { status: 200 },
    });
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-fail",
      request: { url: "https://example.com/broken", method: "POST" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-fail",
      response: { status: 500 },
    });

    await stopNetworkCapture("conv-a");

    const evidence = getEvidence("conv-a");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].correlationId).toBe(investigation.id);
    expect(evidence[0].type).toBe("network-http-error");
  });

  it("reports no active capture, and errors on stop, once none is running", async () => {
    expect(getNetworkCaptureStatus("conv-none")).toBeUndefined();
    const result = await stopNetworkCapture("conv-none");
    expect(result.stopped).toBe(false);
    expect(result.error).toMatch(/no network capture/i);
  });
});

describe("network-capture-session — heartbeat", () => {
  it("re-asserts the debugger attachment every 15s while capturing", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    mockSafeAttachDebugger.mockClear();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockSafeAttachDebugger).toHaveBeenCalledWith(TAB_ID);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(mockSafeAttachDebugger).toHaveBeenCalledTimes(2);

    await stopNetworkCapture("conv-a");
  });

  it("stops the heartbeat once the capture is stopped", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    await stopNetworkCapture("conv-a");
    mockSafeAttachDebugger.mockClear();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockSafeAttachDebugger).not.toHaveBeenCalled();
  });
});

describe("network-capture-session — forced cleanup on tab close / debugger detach", () => {
  it("tears down the capture and frees the conversation's slot when the tab closes mid-capture", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    expect(getActiveCaptureCount()).toBe(1);
    mockSafeAttachDebugger.mockClear();

    fireTabRemoved(TAB_ID);

    expect(getActiveCaptureCount()).toBe(0);
    expect(getNetworkCaptureStatus("conv-a")).toBeUndefined();

    // The heartbeat must actually be cleared, not just the map entry —
    // otherwise this is the exact leak this fix targets.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockSafeAttachDebugger).not.toHaveBeenCalled();

    // The conversation must be free to start a new capture afterward.
    const restarted = await startNetworkCapture("conv-a", TAB_ID);
    expect(restarted.started).toBe(true);
    await stopNetworkCapture("conv-a");
  });

  it("records failed requests captured before an externally-detached debugger as evidence", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-fail",
      request: { url: "https://example.com/broken", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-fail",
      response: { status: 503 },
    });

    fireDebuggerDetach(TAB_ID);

    expect(getActiveCaptureCount()).toBe(0);
    const evidence = getEvidence("conv-a");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].data).toMatchObject({ requestId: "req-fail" });
  });

  it("does not affect a different conversation's capture on an unrelated tab", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    await startNetworkCapture("conv-b", TAB_ID + 1);

    fireTabRemoved(TAB_ID);

    expect(getNetworkCaptureStatus("conv-a")).toBeUndefined();
    expect(getNetworkCaptureStatus("conv-b")).toBeDefined();

    await stopNetworkCapture("conv-b");
  });

  it("exposes the same cleanup via the test-only simulate helper", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    __simulateForcedCleanupForTab(TAB_ID);
    expect(getActiveCaptureCount()).toBe(0);
  });
});

describe("network-capture-session — request cap", () => {
  it("stays untruncated below the cap", async () => {
    await startNetworkCapture("conv-a", TAB_ID);

    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/one", method: "GET" },
    });

    const status = getNetworkCaptureStatus("conv-a");
    expect(status?.truncated).toBe(false);
    expect(status?.requestCount).toBe(1);

    await stopNetworkCapture("conv-a");
  });

  it("evicts the oldest request and sets truncated once more than the cap arrive", async () => {
    await startNetworkCapture("conv-a", TAB_ID);

    for (let i = 0; i < MAX_CAPTURED_REQUESTS + 1; i++) {
      fireDebuggerEvent("Network.requestWillBeSent", {
        requestId: `req-${i}`,
        request: { url: `https://example.com/${i}`, method: "GET" },
      });
    }

    const status = getNetworkCaptureStatus("conv-a");
    expect(status?.requestCount).toBe(MAX_CAPTURED_REQUESTS);
    expect(status?.truncated).toBe(true);

    const stopped = await stopNetworkCapture("conv-a");
    // The very first request (req-0) must have been evicted; the most
    // recent one must still be present.
    expect(stopped.requests?.some((r) => r.requestId === "req-0")).toBe(false);
    expect(
      stopped.requests?.some(
        (r) => r.requestId === `req-${MAX_CAPTURED_REQUESTS}`,
      ),
    ).toBe(true);
  });
});

describe("network-capture-session — response body capture", () => {
  /** Configures mockSendCommand to answer Network.getResponseBody with a fixed result, while leaving Network.enable/disable resolving as the other tests expect. */
  function mockResponseBody(
    result: { body?: string; base64Encoded?: boolean } | undefined,
  ) {
    mockSendCommand.mockImplementation((method: string) => {
      if (method === "Network.getResponseBody") {
        return Promise.resolve(result);
      }
      return Promise.resolve(undefined);
    });
  }

  it("fetches and attaches the body for an XHR request with a textual mimeType", async () => {
    mockResponseBody({
      body: JSON.stringify([{ id: 4385, segmentName: "sales-team" }]),
      base64Encoded: false,
    });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-segments",
      request: { url: "https://example.com/segments.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-segments",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-segments",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    const req = stopped.requests?.find((r) => r.requestId === "req-segments");
    expect(req?.bodyPreview).toBe(
      JSON.stringify([{ id: 4385, segmentName: "sales-team" }]),
    );
    expect(req?.bodyTruncated).toBe(false);
    expect(req?.bodyTooLarge).toBeUndefined();
    expect(req?.bodyUnavailable).toBeUndefined();
  });

  it("does NOT redact a bare 'name' key — it's configuration data (a segment/flow/feature name), not personal data", async () => {
    // Previously a bare `name` key was treated as PII and wholesale-redacted,
    // which masked exactly the field most useful for debugging (e.g. "which
    // segment is this?") while doing nothing to protect real patient data,
    // which arrives under more specific keys (patientName, fullName, ...).
    // See json-redact.ts's PII_KEY_NAMES comment.
    mockResponseBody({
      body: JSON.stringify([{ id: 4385, name: "sales-team" }]),
      base64Encoded: false,
    });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-segments",
      request: { url: "https://example.com/segments.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-segments",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-segments",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    const req = stopped.requests?.find((r) => r.requestId === "req-segments");
    expect(req?.bodyPreview).toBe(
      JSON.stringify([{ id: 4385, name: "sales-team" }]),
    );
  });

  it("still redacts a specific person-identifying key (fullName) even though bare 'name' is no longer treated as PII", async () => {
    mockResponseBody({
      body: JSON.stringify([{ id: 1, fullName: "Jane Doe" }]),
      base64Encoded: false,
    });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-patient",
      request: { url: "https://example.com/patients.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-patient",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-patient",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    const req = stopped.requests?.find((r) => r.requestId === "req-patient");
    expect(req?.bodyPreview).toBe(
      JSON.stringify([{ id: 1, fullName: "<REDACTED>" }]),
    );
  });

  it("decodes a base64Encoded body before redaction/truncation", async () => {
    const raw = JSON.stringify({ hello: "world" });
    mockResponseBody({
      body: Buffer.from(raw, "utf-8").toString("base64"),
      base64Encoded: true,
    });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/data.json", method: "GET" },
      type: "Fetch",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyPreview).toBe(raw);
  });

  it("redacts sensitive content inside the response body", async () => {
    mockResponseBody({
      body: JSON.stringify({ apiKey: "sk-super-secret-value", ok: true }),
      base64Encoded: false,
    });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/config.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyPreview).not.toContain(
      "sk-super-secret-value",
    );
    expect(stopped.requests?.[0].bodyPreview).toContain("ok");
  });

  it("truncates a body longer than MAX_INLINE_BODY_CHARS and sets bodyTruncated", async () => {
    const longBody = "x".repeat(MAX_INLINE_BODY_CHARS + 500);
    mockResponseBody({ body: longBody, base64Encoded: false });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/big.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: longBody.length,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyTruncated).toBe(true);
    expect(stopped.requests?.[0].bodyPreview?.length).toBe(
      MAX_INLINE_BODY_CHARS,
    );
  });

  it("skips the fetch entirely and sets bodyTooLarge above MAX_BODY_FETCH_BYTES", async () => {
    mockResponseBody({ body: "should never be used", base64Encoded: false });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/huge.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: MAX_BODY_FETCH_BYTES + 1,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyTooLarge).toBe(true);
    expect(stopped.requests?.[0].bodyPreview).toBeUndefined();
    expect(mockSendCommand).not.toHaveBeenCalledWith(
      "Network.getResponseBody",
      expect.anything(),
    );
  });

  it("does not attempt a body fetch for a non-XHR/Fetch resource (e.g. a script)", async () => {
    mockResponseBody({ body: "console.log(1)", base64Encoded: false });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/app.js", method: "GET" },
      type: "Script",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/javascript" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyPreview).toBeUndefined();
    expect(stopped.requests?.[0].bodyTooLarge).toBeUndefined();
  });

  it("does not attempt a body fetch for a non-textual mimeType (e.g. an image)", async () => {
    mockResponseBody({ body: "binarydata", base64Encoded: true });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/photo.png", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "image/png" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyPreview).toBeUndefined();
  });

  it("marks bodyUnavailable when CDP returns no body", async () => {
    mockResponseBody(undefined);

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/data.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyUnavailable).toBe(true);
  });

  it("marks bodyUnavailable, without throwing, when the CDP call itself rejects", async () => {
    mockSendCommand.mockImplementation((method: string) => {
      if (method === "Network.getResponseBody") {
        return Promise.reject(new Error("debugger detached"));
      }
      return Promise.resolve(undefined);
    });

    await startNetworkCapture("conv-a", TAB_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/data.json", method: "GET" },
      type: "XHR",
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    fireDebuggerEvent("Network.loadingFinished", {
      requestId: "req-1",
      encodedDataLength: 100,
    });
    await flushMicrotasks();

    const stopped = await stopNetworkCapture("conv-a");
    expect(stopped.requests?.[0].bodyUnavailable).toBe(true);
  });
});

describe("network-capture-session — service-worker keepalive", () => {
  // Regression coverage: a real session with ~30-60s gaps between turns
  // (e.g. waiting out an LLM rate limit) lost its capture between "start"
  // and "stop" every time — the MV3 service worker was suspending after
  // ~30s idle, wiping the in-memory activeByConversation Map. The keepalive
  // alarm exists specifically to stop that from happening while any
  // capture is active.

  it("creates the keepalive alarm when the first capture starts", async () => {
    await startNetworkCapture("conv-a", TAB_ID);

    expect(mockAlarmsCreate).toHaveBeenCalledWith(
      CAPTURE_KEEPALIVE_ALARM_NAME,
      expect.objectContaining({ periodInMinutes: expect.any(Number) }),
    );

    await stopNetworkCapture("conv-a");
  });

  it("does not create a second alarm for a second concurrent capture", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    mockAlarmsCreate.mockClear();

    await startNetworkCapture("conv-b", TAB_ID + 1);
    expect(mockAlarmsCreate).not.toHaveBeenCalled();

    await stopNetworkCapture("conv-a");
    await stopNetworkCapture("conv-b");
  });

  it("does not clear the alarm while another capture is still active", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    await startNetworkCapture("conv-b", TAB_ID + 1);

    await stopNetworkCapture("conv-a");
    expect(mockAlarmsClear).not.toHaveBeenCalled();

    await stopNetworkCapture("conv-b");
    expect(mockAlarmsClear).toHaveBeenCalledWith(CAPTURE_KEEPALIVE_ALARM_NAME);
  });

  it("clears the alarm once the only active capture stops", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    await stopNetworkCapture("conv-a");

    expect(mockAlarmsClear).toHaveBeenCalledWith(CAPTURE_KEEPALIVE_ALARM_NAME);
  });

  it("clears the alarm on forced cleanup (tab closed mid-capture), not just explicit stop", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    mockAlarmsClear.mockClear();

    fireTabRemoved(TAB_ID);

    expect(mockAlarmsClear).toHaveBeenCalledWith(CAPTURE_KEEPALIVE_ALARM_NAME);
  });

  it("re-asserts the debugger attachment for every active capture when the alarm fires", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    await startNetworkCapture("conv-b", TAB_ID + 1);
    mockSafeAttachDebugger.mockClear();

    fireKeepaliveAlarm();

    expect(mockSafeAttachDebugger).toHaveBeenCalledWith(TAB_ID);
    expect(mockSafeAttachDebugger).toHaveBeenCalledWith(TAB_ID + 1);

    await stopNetworkCapture("conv-a");
    await stopNetworkCapture("conv-b");
  });

  it("ignores an alarm event with an unrelated name", async () => {
    await startNetworkCapture("conv-a", TAB_ID);
    mockSafeAttachDebugger.mockClear();

    onAlarmListener({ name: "ws-mcp-keepalive" });

    expect(mockSafeAttachDebugger).not.toHaveBeenCalled();

    await stopNetworkCapture("conv-a");
  });
});
