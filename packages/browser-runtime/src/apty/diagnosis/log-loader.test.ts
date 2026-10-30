import { beforeEach, describe, expect, it, vi } from "vitest";

const EXT_ID = "abcdefghijklmnopabcdefghijklmnop";

const mockSendMessage = vi.hoisted(() => vi.fn());

(globalThis as { chrome?: unknown }).chrome = {
  runtime: {
    id: "agent",
    sendMessage: mockSendMessage,
    lastError: undefined as { message: string } | undefined,
  },
  storage: {
    local: {
      get: vi.fn(async (key: string) => ({
        [key]: { redactionMode: "strict" },
      })),
    },
    onChanged: { addListener: vi.fn() },
  },
};

import { resetRedactionModeForTests } from "../../runtime/redaction-mode";
import { loadLogEvidence } from "./log-loader";

const RESOURCES = [
  {
    requestId: "r1",
    url: "https://client.apty.example/tenant-1/app-urls.json?timestamp=1",
    method: "GET",
    status: 200,
    timestamp: 1,
  },
  {
    requestId: "r2",
    url: "https://client.apty.example/tenant-1/app-2/env-3/segment.json?timestamp=2",
    method: "GET",
    status: 403,
    timestamp: 2,
  },
  {
    requestId: "r3",
    url: "https://client.apty.example/tenant-1/app-2/env-3/workflow.json",
    method: "GET",
    failed: true,
    errorText: "net::ERR_FAILED",
    timestamp: 3,
  },
];

function serve(logs: unknown) {
  mockSendMessage.mockImplementation(
    (
      _id: string,
      message: { type: string },
      callback: (r: unknown) => void,
    ) => {
      if (message.type === "apty-debug-agent:list-observed-resources") {
        callback({ resources: RESOURCES });
      } else if (message.type === "apty-debug-agent:get-service-worker-logs") {
        callback(logs);
      } else {
        callback(undefined);
      }
    },
  );
}

beforeEach(() => {
  mockSendMessage.mockReset();
  chrome.runtime.lastError = undefined;
  resetRedactionModeForTests();
});

describe("loadLogEvidence", () => {
  it("reads the Client's logs redacted, and its calls by name and host only", async () => {
    serve({
      logs: [
        {
          level: "error",
          message: "Error fetching data for jane.doe@example.com",
          timestamp: 1,
        },
      ],
    });
    const page = {
      ok: true as const,
      lines: [],
      framesRead: 1,
      framesDisabled: 0,
    };

    const evidence = await loadLogEvidence(EXT_ID, async () => page);

    expect(evidence.connection).toEqual({ ok: true });
    expect(evidence.clientLogs.ok).toBe(true);
    expect(JSON.stringify(evidence.clientLogs)).not.toContain("jane.doe");
    expect(evidence.calls).toEqual([
      { name: "app-urls.json", host: "client.apty.example", status: 200 },
      { name: "segment.json", host: "client.apty.example", status: 403 },
      {
        name: "workflow.json",
        host: "client.apty.example",
        failed: true,
        errorText: "net::ERR_FAILED",
      },
    ]);
    expect(JSON.stringify(evidence.calls)).not.toContain("tenant-1");
    expect(evidence.page).toBe(page);
  });

  it("names a logs request the Client cannot answer, and still reads its calls", async () => {
    serve({ logs: "not a list" });

    const evidence = await loadLogEvidence(EXT_ID, async () => undefined);

    expect(evidence.clientLogs).toMatchObject({
      ok: false,
      failure: "malformed_response",
    });
    expect(evidence.calls).toHaveLength(3);
  });

  it("says no Client is saved without asking the page", async () => {
    const pageConsole = vi.fn();

    const evidence = await loadLogEvidence(undefined, pageConsole);

    expect(evidence.connection).toMatchObject({
      ok: false,
      failure: "not_configured",
    });
    expect(pageConsole).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
