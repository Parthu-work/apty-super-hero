import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearEvidence, getEvidence } from "./evidence-store";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars, a-p
const OTHER_EXT_ID = "p".repeat(32);

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockManagementGet = vi.hoisted(() => vi.fn());

(global as any).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: undefined as { message: string } | undefined,
  },
  management: {
    get: mockManagementGet,
  },
};

import {
  connectExtensionClient,
  disconnectExtensionClient,
  getActiveExtensionConnectionCount,
  getExtensionConnectionStatus,
  inspectResource,
  isValidExtensionId,
  listObservedResources,
  listServiceWorkerLogs,
  matchResources,
} from "./extension-network-inspector";

/** Route chrome.runtime.sendMessage to a handler keyed by message.type, so tests can script per-message-type responses (status handshake vs. resource listing vs. body). */
function mockResponsesByType(
  handlers: Record<string, unknown | ((message: any) => unknown)>,
) {
  mockSendMessage.mockImplementation(
    (
      _extensionId: string,
      message: { type: string },
      callback: (response: unknown) => void,
    ) => {
      const handler = handlers[message.type];
      if (handler === undefined) {
        callback(undefined);
        return;
      }
      const response =
        typeof handler === "function" ? handler(message) : handler;
      callback(response);
    },
  );
}

const OK_STATUS = { running: true, lastActivity: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  mockSendMessage.mockReset();
  mockManagementGet.mockReset();
  chrome.runtime.lastError = undefined;
  mockManagementGet.mockResolvedValue({ id: EXT_ID, enabled: true });
});

afterEach(() => {
  vi.useRealTimers();
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

describe("connectExtensionClient", () => {
  it("rejects an invalid extension id without calling chrome APIs", async () => {
    const result = await connectExtensionClient("conv-a", "not-an-id");
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe("invalid_extension_id");
    expect(mockManagementGet).not.toHaveBeenCalled();
  });

  it("reports extension_not_found when chrome.management.get rejects", async () => {
    mockManagementGet.mockRejectedValue(new Error("not found"));
    const result = await connectExtensionClient("conv-a", EXT_ID);
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe("extension_not_found");
  });

  it("reports extension_not_found when the extension is disabled", async () => {
    mockManagementGet.mockResolvedValue({ id: EXT_ID, enabled: false });
    const result = await connectExtensionClient("conv-a", EXT_ID);
    expect(result.errorCode).toBe("extension_not_found");
  });

  it("reports unavailable when the extension is installed but does not respond to the message contract", async () => {
    mockResponsesByType({}); // no handler for get-service-worker-status -> undefined -> unavailable
    const result = await connectExtensionClient("conv-a", EXT_ID);
    expect(result.connected).toBe(false);
    expect(result.errorCode).toBe("unavailable");
    expect(result.error).toBeTruthy();
  });

  it("connects when the extension is installed and responds ok", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
    });
    const result = await connectExtensionClient("conv-a", EXT_ID);
    expect(result.connected).toBe(true);
    expect(result.extensionId).toBe(EXT_ID);
    await disconnectExtensionClient("conv-a");
  });

  it("is idempotent when already connected to the same extension", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
    });
    await connectExtensionClient("conv-a", EXT_ID);
    const second = await connectExtensionClient("conv-a", EXT_ID);
    expect(second.connected).toBe(true);
    expect(second.alreadyConnected).toBe(true);
    await disconnectExtensionClient("conv-a");
  });

  it("switching to a different extension replaces the active connection", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
    });
    await connectExtensionClient("conv-a", EXT_ID);
    await connectExtensionClient("conv-a", OTHER_EXT_ID);

    const status = getExtensionConnectionStatus("conv-a");
    expect(status.connected).toBe(true);
    if (status.connected) {
      expect(status.extensionId).toBe(OTHER_EXT_ID);
    }
    await disconnectExtensionClient("conv-a");
  });
});

describe("disconnectExtensionClient / getExtensionConnectionStatus", () => {
  it("reports not connected before any connect call", () => {
    expect(getExtensionConnectionStatus("conv-none")).toEqual({
      connected: false,
    });
  });

  it("disconnect fails cleanly when nothing is connected", async () => {
    const result = await disconnectExtensionClient("conv-none");
    expect(result.disconnected).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("connection count reflects active conversations", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
    });
    const before = getActiveExtensionConnectionCount();
    await connectExtensionClient("conv-a", EXT_ID);
    expect(getActiveExtensionConnectionCount()).toBe(before + 1);
    await disconnectExtensionClient("conv-a");
    expect(getActiveExtensionConnectionCount()).toBe(before);
  });
});

describe("matchResources", () => {
  const requests = [
    {
      requestId: "1",
      url: "https://cdn.apty.io/segments.json",
      method: "GET",
      timestamp: 100,
    },
    {
      requestId: "2",
      url: "https://cdn.apty.io/api/app-segments.json",
      method: "GET",
      timestamp: 200,
    },
    {
      requestId: "3",
      url: "https://cdn.apty.io/flow.json",
      method: "GET",
      timestamp: 300,
    },
  ];

  it("prefers an exact filename match", () => {
    const result = matchResources(requests, "segments.json");
    expect(result[0]?.requestId).toBe("1");
    expect(result[0]?.matchKind).toBe("exact");
  });

  it("matches a path suffix", () => {
    const result = matchResources(requests, "/api/app-segments.json");
    expect(result[0]?.requestId).toBe("2");
    expect(result[0]?.matchKind).toBe("path");
  });

  it("matches a substring fragment", () => {
    const result = matchResources(requests, "segments");
    // Both "segments.json" and "app-segments.json" contain "segments" as a fragment.
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.every((r) => r.matchKind !== undefined)).toBe(true);
  });

  it("returns nothing for an empty query", () => {
    expect(matchResources(requests, "")).toEqual([]);
  });

  it("returns nothing when nothing matches", () => {
    expect(matchResources(requests, "nonexistent.xml")).toEqual([]);
  });
});

describe("listObservedResources", () => {
  it("reports not connected", async () => {
    await expect(listObservedResources("conv-none")).resolves.toEqual({
      connected: false,
    });
  });

  it("lists what the Apty Client reports, with normalized resourceName", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/segments.json",
            method: "GET",
            status: 200,
            mimeType: "application/json",
            timestamp: 1,
          },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await listObservedResources("conv-a");
    expect(result.connected).toBe(true);
    if (result.connected) {
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]?.resourceName).toBe("segments.json");
      expect(result.resources[0]?.status).toBe(200);
    }
    await disconnectExtensionClient("conv-a");
  });

  it("reports not connected when the Apty Client stops responding after connecting", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      // no handler for list-observed-resources -> undefined -> not ok
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await listObservedResources("conv-a");
    expect(result.connected).toBe(false);
    await disconnectExtensionClient("conv-a");
  });
});

describe("inspectResource", () => {
  it("reports not_connected when nothing is connected", async () => {
    const result = await inspectResource("conv-none", "segments.json");
    expect(result.status).toBe("not_connected");
    expect(result.found).toBe(false);
  });

  it("reports not_observed when the Apty Client has no matching resource", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/app.json",
            method: "GET",
            status: 200,
            timestamp: 1,
          },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("not_observed");
    expect(result.found).toBe(false);
    expect(result.observedResources).toContain("app.json");
    await disconnectExtensionClient("conv-a");
  });

  it("reports failed when the matched request failed", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/segments.json",
            method: "GET",
            failed: true,
            errorText: "net::ERR_CONNECTION_RESET",
            timestamp: 1,
          },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("failed");
    expect(result.found).toBe(true);
    await disconnectExtensionClient("conv-a");
  });

  it("reports http_error for a 4xx/5xx response", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/segments.json",
            method: "GET",
            status: 404,
            timestamp: 1,
          },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("http_error");
    await disconnectExtensionClient("conv-a");
  });

  it("reports pending when the request was seen but has no status yet", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/segments.json",
            method: "GET",
            timestamp: 1,
          },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("pending");
    await disconnectExtensionClient("conv-a");
  });

  it("reports body_unavailable when the Apty Client can't provide the body", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/segments.json",
            method: "GET",
            status: 200,
            mimeType: "application/json",
            timestamp: 1,
          },
        ],
      },
      "apty-debug-agent:get-resource-body": { found: false },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.status).toBe("body_unavailable");
    await disconnectExtensionClient("conv-a");
  });

  it("returns the actual body on success, generically for any resource name, and records evidence", async () => {
    for (const [name, body] of [
      ["segments.json", JSON.stringify({ segments: ["a", "b"] })],
      ["app.json", JSON.stringify({ appId: "123" })],
      ["flow.json", JSON.stringify({ steps: [] })],
    ] as const) {
      mockResponsesByType({
        "apty-debug-agent:get-service-worker-status": OK_STATUS,
        "apty-debug-agent:list-observed-resources": {
          resources: [
            {
              requestId: "req-1",
              url: `https://cdn.apty.io/${name}`,
              method: "GET",
              status: 200,
              mimeType: "application/json",
              timestamp: 1,
            },
          ],
        },
        "apty-debug-agent:get-resource-body": {
          found: true,
          body,
          base64Encoded: false,
        },
      });
      await connectExtensionClient("conv-a", EXT_ID);

      const result = await inspectResource("conv-a", name);
      expect(result.status).toBe("ok");
      expect(result.found).toBe(true);
      expect(result.response?.bodyPreview).toBe(body);
      expect(result.response?.evidenceId).toBeTruthy();

      await disconnectExtensionClient("conv-a");
      clearEvidence("conv-a");
    }
  });

  it("redacts secrets in the retrieved body", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/segments.json",
            method: "GET",
            status: 200,
            mimeType: "application/json",
            timestamp: 1,
          },
        ],
      },
      "apty-debug-agent:get-resource-body": {
        found: true,
        body: JSON.stringify({ apiKey: "sk-abcdef1234567890" }),
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await inspectResource("conv-a", "segments.json");
    expect(result.response?.bodyPreview).not.toContain("sk-abcdef1234567890");
    await disconnectExtensionClient("conv-a");
  });

  it("does not decode/redact binary responses, and never shows their body", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:list-observed-resources": {
        resources: [
          {
            requestId: "req-1",
            url: "https://cdn.apty.io/logo.png",
            method: "GET",
            status: 200,
            mimeType: "image/png",
            timestamp: 1,
          },
        ],
      },
      "apty-debug-agent:get-resource-body": {
        found: true,
        body: "iVBORw0KGgo=",
        base64Encoded: true,
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await inspectResource("conv-a", "logo.png");
    expect(result.status).toBe("ok");
    expect(result.response?.isBinary).toBe(true);
    expect(result.response?.bodyPreview).not.toContain("iVBORw0KGgo");
    await disconnectExtensionClient("conv-a");
  });
});

describe("listServiceWorkerLogs", () => {
  it("reports not connected", async () => {
    await expect(listServiceWorkerLogs("conv-none")).resolves.toEqual({
      connected: false,
    });
  });

  it("returns logs the Apty Client reports", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:get-service-worker-logs": {
        logs: [
          { level: "error", message: "boom", timestamp: 1 },
          { level: "log", message: "routine", timestamp: 2 },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await listServiceWorkerLogs("conv-a");
    expect(result.connected).toBe(true);
    if (result.connected) {
      expect(result.logs).toHaveLength(2);
    }
    await disconnectExtensionClient("conv-a");
  });

  it("filters to warning/error entries when onlyErrors is set", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:get-service-worker-logs": {
        logs: [
          { level: "error", message: "boom", timestamp: 1 },
          { level: "log", message: "routine", timestamp: 2 },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    const result = await listServiceWorkerLogs("conv-a", {
      onlyErrors: true,
    });
    expect(result.connected).toBe(true);
    if (result.connected) {
      expect(result.logs).toHaveLength(1);
      expect(result.logs[0]?.text).toBe("boom");
    }
    await disconnectExtensionClient("conv-a");
  });

  it("records warning/error entries as evidence, but not routine ones", async () => {
    mockResponsesByType({
      "apty-debug-agent:get-service-worker-status": OK_STATUS,
      "apty-debug-agent:get-service-worker-logs": {
        logs: [
          { level: "error", message: "boom", timestamp: 1 },
          { level: "log", message: "routine", timestamp: 2 },
        ],
      },
    });
    await connectExtensionClient("conv-a", EXT_ID);

    await listServiceWorkerLogs("conv-a");

    const evidence = getEvidence("conv-a").filter(
      (e) => e.source === "service-worker",
    );
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.type).toBe("service-worker-log");
    await disconnectExtensionClient("conv-a");
  });
});
