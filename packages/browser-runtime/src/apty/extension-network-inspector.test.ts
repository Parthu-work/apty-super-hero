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

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars, a-p
const OTHER_EXT_ID = "p".repeat(32);
const TARGET_ID = "target-1";

const mockAttach = vi.hoisted(() => vi.fn());
const mockDetach = vi.hoisted(() => vi.fn());
const mockSendCommand = vi.hoisted(() => vi.fn());
const mockGetTargets = vi.hoisted(() => vi.fn());
const mockManagementGet = vi.hoisted(() => vi.fn());
const mockOnEventAddListener = vi.hoisted(() => vi.fn());
const mockOnEventRemoveListener = vi.hoisted(() => vi.fn());
const mockOnDetachAddListener = vi.hoisted(() => vi.fn());
const mockOnUninstalledAddListener = vi.hoisted(() => vi.fn());
const mockOnDisabledAddListener = vi.hoisted(() => vi.fn());

(global as any).chrome = {
  debugger: {
    attach: mockAttach,
    detach: mockDetach,
    sendCommand: mockSendCommand,
    getTargets: mockGetTargets,
    onEvent: {
      addListener: mockOnEventAddListener,
      removeListener: mockOnEventRemoveListener,
    },
    onDetach: { addListener: mockOnDetachAddListener },
  },
  management: {
    get: mockManagementGet,
    onUninstalled: { addListener: mockOnUninstalledAddListener },
    onDisabled: { addListener: mockOnDisabledAddListener },
  },
  runtime: { lastError: undefined as { message: string } | undefined },
};

import {
  __simulateExtensionRemoved,
  __simulateForcedDetachForTarget,
  connectExtensionClient,
  disconnectExtensionClient,
  getActiveExtensionConnectionCount,
  getExtensionConnectionStatus,
  inspectResource,
  isValidExtensionId,
  listObservedResources,
  matchResources,
  resolveServiceWorkerTarget,
} from "./extension-network-inspector";

function fireDebuggerEvent(method: string, params: unknown) {
  for (const call of mockOnEventAddListener.mock.calls) {
    const listener = call[0] as (
      source: { targetId?: string },
      method: string,
      params?: object,
    ) => void;
    listener({ targetId: TARGET_ID }, method, params as object);
  }
}

let onDetachListener: (source: { targetId?: string }, reason: string) => void;
let _onUninstalledListener: (extensionId: string) => void;

beforeAll(async () => {
  mockAttach.mockImplementation((_debuggee, _version, cb) => cb());
  mockDetach.mockImplementation((_debuggee, cb) => cb());
  mockSendCommand.mockImplementation((_debuggee, _method, _params, cb) =>
    cb(undefined),
  );
  mockGetTargets.mockImplementation((cb) =>
    cb([
      {
        id: TARGET_ID,
        type: "service_worker",
        url: `chrome-extension://${EXT_ID}/sw.js`,
      },
    ]),
  );
  mockManagementGet.mockResolvedValue({ id: EXT_ID, enabled: true });

  await connectExtensionClient("conv-warmup", EXT_ID);
  onDetachListener = mockOnDetachAddListener.mock.calls[0][0];
  _onUninstalledListener = mockOnUninstalledAddListener.mock.calls[0][0];
  await disconnectExtensionClient("conv-warmup");
});

beforeEach(() => {
  vi.clearAllMocks();
  chrome.runtime.lastError = undefined;
  mockAttach.mockImplementation((_debuggee, _version, cb) => cb());
  mockDetach.mockImplementation((_debuggee, cb) => cb());
  mockSendCommand.mockImplementation((_debuggee, _method, _params, cb) =>
    cb(undefined),
  );
  mockGetTargets.mockImplementation((cb) =>
    cb([
      {
        id: TARGET_ID,
        type: "service_worker",
        url: `chrome-extension://${EXT_ID}/sw.js`,
      },
    ]),
  );
  mockManagementGet.mockResolvedValue({ id: EXT_ID, enabled: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  clearEvidence("conv-a");
});

describe("isValidExtensionId", () => {
  it("accepts a well-formed 32-char a-p extension id", () => {
    expect(isValidExtensionId(EXT_ID)).toBe(true);
  });

  it.each([
    "short",
    "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP",
    "abcdefghijklmnopabcdefghijklmno1",
    "",
  ])("rejects %s", (id) => {
    expect(isValidExtensionId(id)).toBe(false);
  });
});

describe("resolveServiceWorkerTarget", () => {
  it("rejects an invalid extension id without calling chrome APIs", async () => {
    const result = await resolveServiceWorkerTarget("not-an-id");
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("invalid_extension_id");
    expect(mockManagementGet).not.toHaveBeenCalled();
  });

  it("reports extension_not_found when chrome.management.get rejects", async () => {
    mockManagementGet.mockRejectedValue(new Error("not found"));
    const result = await resolveServiceWorkerTarget(EXT_ID);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("extension_not_found");
  });

  it("reports extension_not_found when the extension is disabled", async () => {
    mockManagementGet.mockResolvedValue({ id: EXT_ID, enabled: false });
    const result = await resolveServiceWorkerTarget(EXT_ID);
    expect(result.errorCode).toBe("extension_not_found");
  });

  it("reports service_worker_unavailable when no matching target exists", async () => {
    mockGetTargets.mockImplementation((cb) => cb([]));
    const result = await resolveServiceWorkerTarget(EXT_ID);
    expect(result.errorCode).toBe("service_worker_unavailable");
  });

  it("resolves the service worker target for the given extension", async () => {
    const result = await resolveServiceWorkerTarget(EXT_ID);
    expect(result.ok).toBe(true);
    expect(result.target?.id).toBe(TARGET_ID);
  });
});

describe("connect / disconnect lifecycle", () => {
  it("connects, attaches the debugger, and enables Network capture", async () => {
    const result = await connectExtensionClient("conv-a", EXT_ID);
    expect(result.connected).toBe(true);
    expect(mockAttach).toHaveBeenCalledWith(
      { targetId: TARGET_ID },
      "1.3",
      expect.any(Function),
    );
    expect(mockSendCommand).toHaveBeenCalledWith(
      { targetId: TARGET_ID },
      "Network.enable",
      {},
      expect.any(Function),
    );
    await disconnectExtensionClient("conv-a");
  });

  it("is idempotent when reconnecting to the same extension", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    mockAttach.mockClear();
    const second = await connectExtensionClient("conv-a", EXT_ID);
    expect(second.alreadyConnected).toBe(true);
    expect(mockAttach).not.toHaveBeenCalled();
    await disconnectExtensionClient("conv-a");
  });

  it("disconnects the old extension before connecting to a new one", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    mockGetTargets.mockImplementation((cb) =>
      cb([
        {
          id: "target-2",
          type: "service_worker",
          url: `chrome-extension://${OTHER_EXT_ID}/sw.js`,
        },
      ]),
    );
    mockManagementGet.mockResolvedValue({ id: OTHER_EXT_ID, enabled: true });

    const result = await connectExtensionClient("conv-a", OTHER_EXT_ID);
    expect(result.connected).toBe(true);
    expect(mockDetach).toHaveBeenCalledWith(
      { targetId: TARGET_ID },
      expect.any(Function),
    );
    await disconnectExtensionClient("conv-a");
  });

  it("cleans up the listener and detaches on disconnect", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    const result = await disconnectExtensionClient("conv-a");
    expect(result.disconnected).toBe(true);
    expect(mockOnEventRemoveListener).toHaveBeenCalled();
    expect(mockDetach).toHaveBeenCalledWith(
      { targetId: TARGET_ID },
      expect.any(Function),
    );
    expect(getExtensionConnectionStatus("conv-a")).toEqual({
      connected: false,
    });
  });

  it("errors when disconnecting a conversation with no active connection", async () => {
    const result = await disconnectExtensionClient("conv-none");
    expect(result.disconnected).toBe(false);
    expect(result.error).toMatch(/no apty client connection/i);
  });

  it("reports attach_failed when chrome.debugger.attach fails", async () => {
    mockAttach.mockImplementation((_debuggee, _version, cb) => {
      chrome.runtime.lastError = { message: "cannot attach" };
      cb();
      chrome.runtime.lastError = undefined;
    });
    const result = await connectExtensionClient("conv-a", EXT_ID);
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe("attach_failed");
  });

  it("tears down and reports the same forced-cleanup path on external detach", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    expect(getActiveExtensionConnectionCount()).toBe(1);

    onDetachListener({ targetId: TARGET_ID }, "target_closed");

    expect(getActiveExtensionConnectionCount()).toBe(0);
    expect(getExtensionConnectionStatus("conv-a")).toEqual({
      connected: false,
    });
  });

  it("tears down on extension uninstall via the test-only helper", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    __simulateExtensionRemoved(EXT_ID);
    expect(getActiveExtensionConnectionCount()).toBe(0);
  });

  it("tears down on external detach via the test-only helper", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    __simulateForcedDetachForTarget(TARGET_ID);
    expect(getActiveExtensionConnectionCount()).toBe(0);
  });
});

describe("matchResources", () => {
  const requests = [
    {
      requestId: "r1",
      url: "https://cdn.example.com/config/segments.json",
      method: "GET",
      status: 200,
      timestamp: 1,
    },
    {
      requestId: "r2",
      url: "https://cdn.example.com/config/app.json",
      method: "GET",
      status: 200,
      timestamp: 2,
    },
    {
      requestId: "r3",
      url: "https://cdn.example.com/v2/segments.json",
      method: "GET",
      status: 200,
      timestamp: 3,
    },
  ];

  it("matches an exact filename", () => {
    const matches = matchResources(requests, "app.json");
    expect(matches).toHaveLength(1);
    expect(matches[0].requestId).toBe("r2");
    expect(matches[0].matchKind).toBe("exact");
  });

  it("resolves multiple exact matches deterministically by most-recent timestamp", () => {
    const matches = matchResources(requests, "segments.json");
    expect(matches.map((m) => m.requestId)).toEqual(["r3", "r1"]);
  });

  it("matches a path fragment", () => {
    const matches = matchResources(requests, "/v2/segments.json");
    expect(matches[0].requestId).toBe("r3");
    expect(matches[0].matchKind).toBe("path");
  });

  it("matches a bare substring fragment", () => {
    const matches = matchResources(requests, "segments");
    expect(matches.map((m) => m.requestId).sort()).toEqual(["r1", "r3"]);
    expect(matches.every((m) => m.matchKind === "fragment")).toBe(true);
  });

  it("returns no matches for an unrelated query", () => {
    expect(matchResources(requests, "flow.json")).toHaveLength(0);
  });
});

describe("inspectResource", () => {
  it("reports not_connected when no session is active", async () => {
    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("not_connected");
    expect(result.found).toBe(false);
  });

  it("reports not_observed and lists what was seen instead", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/app.json", method: "GET" },
    });

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("not_observed");
    expect(result.observedResources).toContain("app.json");
    await disconnectExtensionClient("conv-a");
  });

  it("reports a failed request", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/segments.json", method: "GET" },
    });
    fireDebuggerEvent("Network.loadingFailed", {
      requestId: "req-1",
      errorText: "net::ERR_FAILED",
    });

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/failed/i);
    await disconnectExtensionClient("conv-a");
  });

  it("reports an http_error for a 4xx/5xx response", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/segments.json", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 403, mimeType: "application/json" },
    });

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("http_error");
    expect(result.error).toMatch(/403/);
    await disconnectExtensionClient("conv-a");
  });

  it("reports pending when observed but no response yet", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/segments.json", method: "GET" },
    });

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("pending");
    await disconnectExtensionClient("conv-a");
  });

  it("reports body_unavailable when getResponseBody fails", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/segments.json", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    mockSendCommand.mockImplementation((_debuggee, method, _params, cb) => {
      if (method === "Network.getResponseBody") {
        chrome.runtime.lastError = {
          message: "No resource with given identifier",
        };
        cb(undefined);
        chrome.runtime.lastError = undefined;
        return;
      }
      cb(undefined);
    });

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("body_unavailable");
    await disconnectExtensionClient("conv-a");
  });

  it("retrieves and returns the actual response body for segments.json, unmodified across resources", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/segments.json", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    mockSendCommand.mockImplementation((_debuggee, method, _params, cb) => {
      if (method === "Network.getResponseBody") {
        cb({
          body: JSON.stringify({ segments: ["a", "b"] }),
          base64Encoded: false,
        });
        return;
      }
      cb(undefined);
    });

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("ok");
    expect(result.response?.bodyPreview).toContain('"segments"');
    expect(result.response?.evidenceId).toBeTruthy();

    const evidence = getEvidence("conv-a");
    expect(evidence).toHaveLength(1);
    expect(evidence[0].type).toBe("network-response");
    expect(evidence[0].data).toMatchObject({ resourceName: "segments.json" });
    await disconnectExtensionClient("conv-a");
  });

  it("works identically for a different resource name without any code change (app.json)", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-2",
      request: { url: "https://example.com/app.json", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-2",
      response: { status: 200, mimeType: "application/json" },
    });
    mockSendCommand.mockImplementation((_debuggee, method, _params, cb) => {
      if (method === "Network.getResponseBody") {
        cb({ body: JSON.stringify({ app: "config" }), base64Encoded: false });
        return;
      }
      cb(undefined);
    });

    const result = await inspectResource("conv-a", "app.json");
    expect(result.status).toBe("ok");
    expect(result.response?.bodyPreview).toContain('"app"');
    await disconnectExtensionClient("conv-a");
  });

  it("redacts sensitive values found in the response body", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/flow.json", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });
    mockSendCommand.mockImplementation((_debuggee, method, _params, cb) => {
      if (method === "Network.getResponseBody") {
        cb({
          body: JSON.stringify({ apiKey: "sk-super-secret-value", flow: "ok" }),
          base64Encoded: false,
        });
        return;
      }
      cb(undefined);
    });

    const result = await inspectResource("conv-a", "flow.json");
    expect(result.response?.bodyPreview).not.toContain("sk-super-secret-value");
    expect(result.response?.bodyPreview).toContain("<REDACTED>");
    await disconnectExtensionClient("conv-a");
  });

  it("does not attempt to decode a binary response body", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/logo.png", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "image/png" },
    });
    mockSendCommand.mockImplementation((_debuggee, method, _params, cb) => {
      if (method === "Network.getResponseBody") {
        cb({ body: "iVBORw0KGgo=", base64Encoded: true });
        return;
      }
      cb(undefined);
    });

    const result = await inspectResource("conv-a", "logo.png");
    expect(result.response?.isBinary).toBe(true);
    expect(result.response?.bodyPreview).toMatch(/binary/i);
    await disconnectExtensionClient("conv-a");
  });
});

describe("listObservedResources", () => {
  it("reports not connected", () => {
    expect(listObservedResources("conv-none")).toEqual({ connected: false });
  });

  it("lists observed resources with normalized resourceName", async () => {
    await connectExtensionClient("conv-a", EXT_ID);
    fireDebuggerEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/segments.json", method: "GET" },
    });
    fireDebuggerEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, mimeType: "application/json" },
    });

    const result = listObservedResources("conv-a");
    expect(result.connected).toBe(true);
    if (result.connected) {
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0].resourceName).toBe("segments.json");
      expect(result.resources[0].status).toBe(200);
    }
    await disconnectExtensionClient("conv-a");
  });
});
