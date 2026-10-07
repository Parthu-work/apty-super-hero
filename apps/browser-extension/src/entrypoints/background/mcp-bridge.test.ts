import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConnect = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("@apty/browser-runtime", () => ({
  wsMcpServer: {
    connect: mockConnect,
    disconnect: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn(() => ({ status: "disconnected" })),
    onStatusChange: vi.fn(),
    getSavedUrl: vi.fn().mockResolvedValue(null),
    getSavedToken: vi.fn().mockResolvedValue(null),
    handleAlarm: vi.fn(),
  },
}));

const EXTENSION_ID = "this-extension-id";
let registeredListener:
  | ((message: any, sender: any, sendResponse: (r: unknown) => void) => boolean)
  | undefined;

(global as any).chrome = {
  runtime: {
    id: EXTENSION_ID,
    onMessage: {
      addListener: (
        listener: (
          message: any,
          sender: any,
          sendResponse: (r: unknown) => void,
        ) => boolean,
      ) => {
        registeredListener = listener;
      },
    },
  },
  alarms: { onAlarm: { addListener: vi.fn() } },
  action: {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  },
};

import { registerMcpBridge } from "./mcp-bridge";

const TRUSTED_SENDER = { id: EXTENSION_ID };
const UNTRUSTED_SENDER = { id: EXTENSION_ID, tab: { id: 1 } };

function invoke(message: unknown, sender: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    registeredListener?.(message, sender, resolve);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  registeredListener = undefined;
  registerMcpBridge();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mcp-bridge — ws-bridge-connect sender check", () => {
  it("accepts a connect request from a trusted extension page", async () => {
    const result = (await invoke(
      { request: "ws-bridge-connect", url: "ws://localhost:1234", token: "t" },
      TRUSTED_SENDER,
    )) as any;
    expect(result.success).toBe(true);
    expect(mockConnect).toHaveBeenCalledWith("ws://localhost:1234", "t");
  });

  it("rejects a connect request from a content script, never reaching wsMcpServer.connect", async () => {
    const result = (await invoke(
      { request: "ws-bridge-connect", url: "ws://localhost:1234", token: "t" },
      UNTRUSTED_SENDER,
    )) as any;
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unauthorized/i);
    expect(mockConnect).not.toHaveBeenCalled();
  });
});
