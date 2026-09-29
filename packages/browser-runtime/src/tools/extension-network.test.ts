import { beforeEach, describe, expect, it, vi } from "vitest";

// The extension ID the *user* configured via Options — the only one any of
// these tools may ever contact.
const CONFIGURED_EXT_ID = "abcdefghijklmnopabcdefghijklmnop"; // 32 chars, a-p
// An extension ID an attacker-controlled/prompt-injected page might try to
// smuggle into a tool call's arguments — must never be reached.
const ATTACKER_EXT_ID = "p".repeat(32);

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockManagementGet = vi.hoisted(() => vi.fn());
const mockStorageGet = vi.hoisted(() => vi.fn());

(global as any).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: undefined as { message: string } | undefined,
  },
  management: {
    get: mockManagementGet,
  },
  storage: {
    local: {
      get: mockStorageGet,
    },
  },
};

import {
  connectAptyClientTool,
  getExtensionServiceWorkerLogsTool,
  inspectExtensionNetworkTool,
  listExtensionNetworkResourcesTool,
} from "./extension-network";

const OK_STATUS = {
  running: true,
  lastActivity: 1,
  product: "apty-client",
  extensionId: CONFIGURED_EXT_ID,
  contractVersion: 1,
};

function configureExtensionId(id: string | undefined) {
  mockStorageGet.mockResolvedValue({
    "apty-integration-config": id ? { clientExtensionId: id } : {},
  });
}

beforeEach(() => {
  mockSendMessage.mockReset();
  mockManagementGet.mockReset();
  mockStorageGet.mockReset();
  chrome.runtime.lastError = undefined;

  mockManagementGet.mockResolvedValue({ enabled: true });
  mockSendMessage.mockImplementation(
    (
      _extensionId: string,
      _message: unknown,
      callback: (response: unknown) => void,
    ) => callback(OK_STATUS),
  );
});

describe("extension-network tools — the model can never supply an extension ID", () => {
  it("connect_apty_client's schema takes no input at all", async () => {
    // A malformed/extra field the model might still try to pass must not
    // silently flow through unnoticed — asserting the schema is `{}` is the
    // strongest guarantee: there is no field for an id to travel through.
    expect(
      Object.keys(connectAptyClientTool.parameters?.properties ?? {}),
    ).toEqual([]);
  });

  it("connect_apty_client always contacts the user-configured extension ID, ignoring any extensionId smuggled into the call", async () => {
    configureExtensionId(CONFIGURED_EXT_ID);

    const result = (await connectAptyClientTool.invoke(
      {} as any,
      JSON.stringify({ extensionId: ATTACKER_EXT_ID }),
    )) as any;

    expect(result.connected).toBe(true);
    expect(mockManagementGet).toHaveBeenCalledWith(CONFIGURED_EXT_ID);
    expect(mockManagementGet).not.toHaveBeenCalledWith(ATTACKER_EXT_ID);
  });

  it("connect_apty_client reports not_configured (never a fabricated connection) when no extension ID is configured", async () => {
    configureExtensionId(undefined);

    const result = (await connectAptyClientTool.invoke(
      {} as any,
      JSON.stringify({}),
    )) as any;

    expect(result.connected).toBe(false);
    expect(result.error).toMatch(/configured/i);
    expect(mockManagementGet).not.toHaveBeenCalled();
  });

  it("inspect_extension_network auto-connects using the configured ID, not an attacker-supplied one", async () => {
    configureExtensionId(CONFIGURED_EXT_ID);
    mockSendMessage.mockImplementation(
      (
        _extensionId: string,
        message: { type: string },
        callback: (response: unknown) => void,
      ) => {
        if (message.type === "apty-debug-agent:get-service-worker-status") {
          callback(OK_STATUS);
        } else {
          callback({ resources: [] });
        }
      },
    );

    await inspectExtensionNetworkTool.invoke(
      { context: { conversationId: "conv-1" } } as any,
      JSON.stringify({
        resourceQuery: "segments.json",
        extensionId: ATTACKER_EXT_ID,
      }),
    );

    expect(mockManagementGet).toHaveBeenCalledWith(CONFIGURED_EXT_ID);
    expect(mockManagementGet).not.toHaveBeenCalledWith(ATTACKER_EXT_ID);
  });

  it("list_extension_network_resources's schema takes no extensionId field", () => {
    expect(
      Object.keys(
        listExtensionNetworkResourcesTool.parameters?.properties ?? {},
      ),
    ).toEqual([]);
  });

  it("get_extension_service_worker_logs's schema only exposes onlyErrors, never extensionId", () => {
    expect(
      Object.keys(
        getExtensionServiceWorkerLogsTool.parameters?.properties ?? {},
      ),
    ).toEqual(["onlyErrors"]);
  });
});
