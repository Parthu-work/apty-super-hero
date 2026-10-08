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

let storageStore: Record<string, unknown> = {};

(global as any).chrome = {
  debugger: {
    onEvent: {
      addListener: mockAddListener,
      removeListener: mockRemoveListener,
    },
  },
  tabs: {
    get: vi.fn(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/page",
    })),
    query: vi.fn(async () => [{ id: 7, url: "https://example.com/page" }]),
  },
  storage: {
    local: {
      get: (key: string) => Promise.resolve({ [key]: storageStore[key] }),
      set: (items: Record<string, unknown>) => {
        storageStore = { ...storageStore, ...items };
        return Promise.resolve();
      },
    },
  },
};

import { resetApprovalStateForTests } from "./approval";
import { answerApprovals } from "./approval-test-utils";
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

beforeEach(async () => {
  vi.clearAllMocks();
  mockSafeAttachDebugger.mockResolvedValue(true);
  mockSafeDetachDebugger.mockResolvedValue(undefined);
  storageStore = {};
  await resetApprovalStateForTests();
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
  function invoke(conversationId: string, expression: string): Promise<any> {
    const runContext = { context: { conversationId, tabId: TAB_ID } };
    return runConsoleCommandTool.invoke(
      runContext as any,
      JSON.stringify({ expression }),
    );
  }

  function invokeAndApprove(
    conversationId: string,
    expression: string,
  ): Promise<any> {
    answerApprovals({ approved: true });
    return invoke(conversationId, expression);
  }

  it("never executes without a human decision", async () => {
    const result = await invoke("conv-console-gate", "1 + 41");

    expect(result).toMatchObject({
      status: "denied",
      reason: "no_approval_ui",
    });
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(mockSafeAttachDebugger).not.toHaveBeenCalled();
  });

  it("shows the user the exact expression it will run", async () => {
    const { requests } = answerApprovals({ approved: false });

    await invoke("conv-console-summary", "document.cookie");

    expect(requests).toHaveLength(1);
    expect(requests[0].toolName).toBe("run_console_command");
    expect(requests[0].summary).toContain("document.cookie");
  });

  it("denying the approval never executes the expression", async () => {
    answerApprovals({ approved: false });

    const result = await invoke("conv-console-deny", "1 + 1");

    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("a remembered approval lets the next call on the same origin run without a prompt", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Runtime.evaluate") {
        return { result: { type: "number", value: 1 } };
      }
      return undefined;
    });
    const { requests, stop } = answerApprovals({
      approved: true,
      remember: true,
    });
    await invoke("conv-console-regrant", "1");
    stop();

    const second = await invoke("conv-console-other", "2");

    expect(requests).toHaveLength(1);
    expect(second.available).toBe(true);
    expect(second.success).toBe(true);
  });

  it("evaluates an expression and returns its JSON-serializable result", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "Runtime.evaluate") {
        return { result: { type: "number", value: 42 } };
      }
      return undefined;
    });

    const result = await invokeAndApprove("conv-console", "1 + 41");

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

    const result = await invokeAndApprove(
      "conv-console-log",
      "console.log('hi')",
    );

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

    const result = await invokeAndApprove(
      "conv-console-error",
      "x.doSomething()",
    );

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

    const result = await invokeAndApprove(
      "conv-console-redact",
      "getAuthHeader()",
    );

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

    const result = await invokeAndApprove(
      "conv-console-truncate",
      "getHugeString()",
    );

    expect(result.result.length).toBeLessThan(5000);
    expect(result.result).toContain("truncated");
  });

  it("reports failure without throwing when the debugger cannot attach", async () => {
    mockSafeAttachDebugger.mockResolvedValueOnce(false);

    const result = await invokeAndApprove("conv-console-noattach", "1 + 1");

    expect(result.available).toBe(false);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });
});
