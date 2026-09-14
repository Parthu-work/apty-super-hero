import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendCommand = vi.hoisted(() => vi.fn());
const mockSafeAttachDebugger = vi.hoisted(() => vi.fn());
const mockSafeDetachDebugger = vi.hoisted(() => vi.fn());

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
    onEvent: { addListener: vi.fn(), removeListener: vi.fn() },
    onDetach: { addListener: vi.fn() },
  },
  tabs: {
    onRemoved: { addListener: vi.fn() },
    get: vi.fn(async (tabId: number) => ({ id: tabId })),
    query: vi.fn(async () => [{ id: TAB_ID }]),
  },
};

const TAB_ID = 9;

import {
  getNetworkCaptureStatusTool,
  startNetworkCaptureTool,
  stopNetworkCaptureTool,
} from "./network-capture";

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

describe("start_network_capture / get_network_capture_status / stop_network_capture", () => {
  it("starts, reports status, and stops a capture end to end", async () => {
    const ctx = runContextFor("conv-tool-a");

    const startResult = (await startNetworkCaptureTool.invoke(
      ctx,
      JSON.stringify({}),
    )) as any;
    expect(startResult.started).toBe(true);

    const statusResult = (await getNetworkCaptureStatusTool.invoke(
      ctx,
      JSON.stringify({}),
    )) as any;
    expect(statusResult.active).toBe(true);
    expect(statusResult.session.status).toBe("capturing");

    const stopResult = (await stopNetworkCaptureTool.invoke(
      ctx,
      JSON.stringify({}),
    )) as any;
    expect(stopResult.stopped).toBe(true);
    expect(stopResult.count).toBe(0);
  });

  it("reports inactive status when no capture is running", async () => {
    const result = (await getNetworkCaptureStatusTool.invoke(
      runContextFor("conv-tool-none"),
      JSON.stringify({}),
    )) as any;
    expect(result.active).toBe(false);
  });

  it("errors on stop when no capture is running for the conversation", async () => {
    const result = (await stopNetworkCaptureTool.invoke(
      runContextFor("conv-tool-nostop"),
      JSON.stringify({}),
    )) as any;
    expect(result.stopped).toBe(false);
    expect(result.error).toMatch(/no network capture/i);
  });

  it("isolates capture state between conversations calling the same tools", async () => {
    const ctxA = runContextFor("conv-tool-iso-a");
    const ctxB = runContextFor("conv-tool-iso-b");

    await startNetworkCaptureTool.invoke(ctxA, JSON.stringify({}));

    const statusB = (await getNetworkCaptureStatusTool.invoke(
      ctxB,
      JSON.stringify({}),
    )) as any;
    expect(statusB.active).toBe(false);

    await stopNetworkCaptureTool.invoke(ctxA, JSON.stringify({}));
  });
});
