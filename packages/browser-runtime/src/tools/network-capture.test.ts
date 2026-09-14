import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  tabs: {
    get: vi.fn(async (tabId: number) => ({ id: tabId })),
    query: vi.fn(async () => [{ id: 7 }]),
  },
};

import {
  getNetworkCaptureStatusTool,
  startNetworkCaptureTool,
  stopNetworkCaptureTool,
} from "./network-capture";

const TAB_ID = 7;

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

function runContextFor(conversationId: string) {
  return { context: { conversationId, tabId: TAB_ID } } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSafeAttachDebugger.mockResolvedValue(true);
  mockSafeDetachDebugger.mockResolvedValue(undefined);
  mockSendCommand.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("start_network_capture / stop_network_capture / get_network_capture_status", () => {
  it("starts idle, reports active once started, and goes idle again after stop", async () => {
    const before = (await getNetworkCaptureStatusTool.invoke(
      runContextFor("conv-tool-a"),
      "{}",
    )) as any;
    expect(before.active).toBe(false);

    const started = (await startNetworkCaptureTool.invoke(
      runContextFor("conv-tool-a"),
      "{}",
    )) as any;
    expect(started.started).toBe(true);
    expect(started.session.status).toBe("capturing");

    const during = (await getNetworkCaptureStatusTool.invoke(
      runContextFor("conv-tool-a"),
      "{}",
    )) as any;
    expect(during.active).toBe(true);

    const stopped = (await stopNetworkCaptureTool.invoke(
      runContextFor("conv-tool-a"),
      JSON.stringify({ onlyErrors: false }),
    )) as any;
    expect(stopped.stopped).toBe(true);
    expect(stopped.count).toBe(0);

    const after = (await getNetworkCaptureStatusTool.invoke(
      runContextFor("conv-tool-a"),
      "{}",
    )) as any;
    expect(after.active).toBe(false);
  });

  it("returns captured requests on stop", async () => {
    await startNetworkCaptureTool.invoke(runContextFor("conv-tool-b"), "{}");

    fireEvent("Network.requestWillBeSent", {
      requestId: "req-1",
      request: { url: "https://example.com/x", method: "GET" },
    });
    fireEvent("Network.responseReceived", {
      requestId: "req-1",
      response: { status: 200, statusText: "OK" },
    });

    const stopped = (await stopNetworkCaptureTool.invoke(
      runContextFor("conv-tool-b"),
      JSON.stringify({ onlyErrors: false }),
    )) as any;

    expect(stopped.count).toBe(1);
    expect(stopped.requests[0].requestId).toBe("req-1");
  });

  it("reports an error when stopping without an active capture, without throwing", async () => {
    const result = (await stopNetworkCaptureTool.invoke(
      runContextFor("conv-tool-never-started"),
      JSON.stringify({ onlyErrors: false }),
    )) as any;

    expect(result.stopped).toBe(false);
    expect(result.error).toMatch(/no network capture/i);
  });

  it("reports a clear error when starting twice without stopping", async () => {
    await startNetworkCaptureTool.invoke(runContextFor("conv-tool-c"), "{}");
    const second = (await startNetworkCaptureTool.invoke(
      runContextFor("conv-tool-c"),
      "{}",
    )) as any;

    expect(second.started).toBe(false);
    expect(second.error).toMatch(/already running/);

    await stopNetworkCaptureTool.invoke(
      runContextFor("conv-tool-c"),
      JSON.stringify({ onlyErrors: false }),
    );
  });
});
