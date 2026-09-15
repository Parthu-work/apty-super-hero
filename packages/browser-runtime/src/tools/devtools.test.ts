import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEvidence } from "../apty/evidence-store";

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
  getNetworkDiagnosticsTool,
  getRuntimeDiagnosticsTool,
  runConsoleCommandTool,
} from "./devtools";

const TAB_ID = 7;

/** Fires every event registered via `chrome.debugger.onEvent.addListener` for the current capture, as if it came from `TAB_ID`. */
function fireDebuggerEvent(method: string, params: unknown) {
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getNetworkDiagnosticsTool — evidence recording", () => {
  it("records only failed/error requests as evidence, not successful ones", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Network.enable") {
        // Fire events once the capture window "opens".
        fireDebuggerEvent("Network.requestWillBeSent", {
          requestId: "req-ok",
          request: { url: "https://example.com/ok", method: "GET" },
        });
        fireDebuggerEvent("Network.responseReceived", {
          requestId: "req-ok",
          response: { status: 200, statusText: "OK" },
        });
        fireDebuggerEvent("Network.requestWillBeSent", {
          requestId: "req-fail",
          request: { url: "https://example.com/broken", method: "POST" },
        });
        fireDebuggerEvent("Network.responseReceived", {
          requestId: "req-fail",
          response: { status: 500, statusText: "Internal Server Error" },
        });
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-network", tabId: TAB_ID },
    };
    await getNetworkDiagnosticsTool.invoke(
      runContext as any,
      JSON.stringify({ windowMs: 500, onlyErrors: false }),
    );

    const evidence = getEvidence("conv-network");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.type).toBe("network-http-error");
    expect(evidence[0]?.requestId).toBe("req-fail");
    expect(evidence[0]?.tabId).toBe(TAB_ID);
  });

  it("records a failed (never-responded) request as network-failed evidence", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Network.enable") {
        fireDebuggerEvent("Network.requestWillBeSent", {
          requestId: "req-cors",
          request: { url: "https://example.com/cors", method: "GET" },
        });
        fireDebuggerEvent("Network.loadingFailed", {
          requestId: "req-cors",
          errorText: "net::ERR_FAILED",
        });
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-network-failed", tabId: TAB_ID },
    };
    await getNetworkDiagnosticsTool.invoke(
      runContext as any,
      JSON.stringify({ windowMs: 500, onlyErrors: false }),
    );

    const evidence = getEvidence("conv-network-failed");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.type).toBe("network-failed");
  });
});

describe("getRuntimeDiagnosticsTool — classification", () => {
  it("classifies captured log entries and exceptions into categories", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Log.enable") {
        fireDebuggerEvent("Log.entryAdded", {
          entry: {
            level: "error",
            source: "security",
            text: "Refused to load the script because it violates the following Content Security Policy directive",
          },
        });
        fireDebuggerEvent("Log.entryAdded", {
          entry: { level: "warning", source: "other", text: "just fyi" },
        });
      } else if (command === "Runtime.enable") {
        fireDebuggerEvent("Runtime.exceptionThrown", {
          exceptionDetails: {
            exception: { description: "TypeError: boom" },
          },
        });
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-runtime-classify", tabId: TAB_ID },
    };
    const result = (await getRuntimeDiagnosticsTool.invoke(
      runContext as any,
      JSON.stringify({ windowMs: 500 }),
    )) as any;

    expect(result.events.map((e: any) => e.category)).toEqual([
      "csp-violation",
      "console-warning",
      "js-exception",
    ]);
    expect(result.categoryCounts).toEqual({
      "csp-violation": 1,
      "console-warning": 1,
      "js-exception": 1,
    });

    // Existing significance rule is unchanged by classification: every
    // warning/error-level log entry and every exception is still recorded.
    const evidence = getEvidence("conv-runtime-classify");
    expect(evidence).toHaveLength(3);
  });
});

describe("runConsoleCommandTool", () => {
  it("evaluates an expression and returns its JSON-serializable result", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Runtime.evaluate") {
        return { result: { type: "number", value: 42 } };
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-console", tabId: TAB_ID },
    };
    const result = (await runConsoleCommandTool.invoke(
      runContext as any,
      JSON.stringify({ expression: "1 + 41" }),
    )) as any;

    expect(result.available).toBe(true);
    expect(result.success).toBe(true);
    expect(result.result).toBe("42");
    expect(mockSafeAttachDebugger).toHaveBeenCalledWith(TAB_ID);
    expect(mockSafeDetachDebugger).toHaveBeenCalledWith(TAB_ID);
  });

  it("reports console.log-style undefined results as a successful no-value run", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Runtime.evaluate") {
        return { result: { type: "undefined" } };
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-console-log", tabId: TAB_ID },
    };
    const result = (await runConsoleCommandTool.invoke(
      runContext as any,
      JSON.stringify({ expression: "console.log('hi')" }),
    )) as any;

    expect(result.available).toBe(true);
    expect(result.success).toBe(true);
    expect(result.result).toBe("undefined");
  });

  it("reports a thrown exception as an honest failure, not a tool error", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Runtime.evaluate") {
        return {
          exceptionDetails: {
            exception: { description: "ReferenceError: x is not defined" },
          },
        };
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-console-error", tabId: TAB_ID },
    };
    const result = (await runConsoleCommandTool.invoke(
      runContext as any,
      JSON.stringify({ expression: "x.doSomething()" }),
    )) as any;

    expect(result.available).toBe(true);
    expect(result.success).toBe(false);
    expect(result.error).toContain("ReferenceError");
    expect(mockSafeDetachDebugger).toHaveBeenCalledWith(TAB_ID);
  });

  it("redacts sensitive-looking values before returning the result", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Runtime.evaluate") {
        return {
          result: { type: "string", value: 'token: "abc123secrettoken"' },
        };
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-console-redact", tabId: TAB_ID },
    };
    const result = (await runConsoleCommandTool.invoke(
      runContext as any,
      JSON.stringify({ expression: "getAuthHeader()" }),
    )) as any;

    expect(result.result).not.toContain("abc123secrettoken");
    expect(result.result).toContain("REDACTED");
  });

  it("truncates very large results", async () => {
    const hugeValue = "x".repeat(5000);
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Runtime.evaluate") {
        return { result: { type: "string", value: hugeValue } };
      }
      return undefined;
    });

    const runContext = {
      context: { conversationId: "conv-console-truncate", tabId: TAB_ID },
    };
    const result = (await runConsoleCommandTool.invoke(
      runContext as any,
      JSON.stringify({ expression: "getHugeString()" }),
    )) as any;

    expect(result.result.length).toBeLessThan(5000);
    expect(result.result).toContain("truncated");
  });

  it("reports failure without throwing when the debugger cannot attach", async () => {
    mockSafeAttachDebugger.mockResolvedValueOnce(false);

    const runContext = {
      context: { conversationId: "conv-console-noattach", tabId: TAB_ID },
    };
    const result = (await runConsoleCommandTool.invoke(
      runContext as any,
      JSON.stringify({ expression: "1 + 1" }),
    )) as any;

    expect(result.available).toBe(false);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });
});
