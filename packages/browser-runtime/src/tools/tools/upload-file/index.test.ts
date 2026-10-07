import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSendCommand = vi.hoisted(() => vi.fn());
const mockSafeAttachDebugger = vi.hoisted(() => vi.fn());
const mockSafeDetachDebugger = vi.hoisted(() => vi.fn());

vi.mock("../../../automation/cdp-commander", () => ({
  CdpCommander: class {
    sendCommand = mockSendCommand;
  },
}));

vi.mock("../../../automation/debugger-manager", () => ({
  debuggerManager: {
    safeAttachDebugger: mockSafeAttachDebugger,
    safeDetachDebugger: mockSafeDetachDebugger,
  },
}));

let storageStore: Record<string, unknown> = {};

const TAB_ID = 11;

(global as any).chrome = {
  tabs: {
    get: vi.fn(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/upload",
    })),
    query: vi.fn(async () => [
      { id: TAB_ID, url: "https://example.com/upload" },
    ]),
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

import { confirmRiskyAction, resetApprovalStateForTests } from "../../approval";
import { uploadFileToInputTool } from "./index";

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

/** Invoke the tool, confirm the resulting pending approval, and return the EXECUTED result. */
async function invokeAndApprove(
  conversationId: string,
  args: Record<string, unknown>,
): Promise<any> {
  const runContext = { context: { conversationId, tabId: TAB_ID } };
  const pending = (await uploadFileToInputTool.invoke(
    runContext as any,
    JSON.stringify(args),
  )) as any;
  expect(pending.status).toBe("needs_approval");
  expect(pending.approvalId).toBeTruthy();
  const confirmed = await confirmRiskyAction(
    conversationId,
    pending.approvalId,
    true,
  );
  expect(confirmed.found).toBe(true);
  expect(confirmed.executed).toBe(true);
  return confirmed.result;
}

describe("uploadFileToInputTool", () => {
  it("never writes the file on the first call — returns a pending approval", async () => {
    const runContext = {
      context: { conversationId: "conv-upload-gate", tabId: TAB_ID },
    };
    const result = (await uploadFileToInputTool.invoke(
      runContext as any,
      JSON.stringify({ file_path: "/tmp/resume.pdf" }),
    )) as any;

    expect(result.status).toBe("needs_approval");
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(mockSafeAttachDebugger).not.toHaveBeenCalled();
  });

  it("denying the approval never touches the page", async () => {
    const runContext = {
      context: { conversationId: "conv-upload-deny", tabId: TAB_ID },
    };
    const pending = (await uploadFileToInputTool.invoke(
      runContext as any,
      JSON.stringify({ file_path: "/tmp/resume.pdf" }),
    )) as any;

    const confirmed = await confirmRiskyAction(
      "conv-upload-deny",
      pending.approvalId,
      false,
    );
    expect(confirmed.denied).toBe(true);
    expect(mockSendCommand).not.toHaveBeenCalled();
  });

  it("no longer accepts a model-supplied tabId — always binds to the conversation's own resolved tab", () => {
    // The old implementation took `tabId` as a direct tool parameter; the
    // security audit flagged this (any caller-supplied tabId was trusted
    // with no check it belongs to the calling conversation). Asserting the
    // schema itself has no such field is the strongest guarantee.
    expect(
      Object.keys(uploadFileToInputTool.parameters?.properties ?? {}),
    ).not.toContain("tabId");
  });

  it("uploads to the resolved file input and reports the filename, after approval", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (command === "DOM.querySelectorAll") return { nodeIds: [42] };
      if (command === "DOM.setFileInputFiles") return {};
      return undefined;
    });

    const result = await invokeAndApprove("conv-upload-ok", {
      file_path: "/tmp/resume.pdf",
    });

    expect(result.success).toBe(true);
    expect(result.filename).toBe("resume.pdf");
    expect(mockSafeAttachDebugger).toHaveBeenCalledWith(TAB_ID);
    expect(mockSafeDetachDebugger).toHaveBeenCalledWith(TAB_ID);
  });

  it("reports a clear failure when no file input exists on the page", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (command === "DOM.querySelectorAll") return { nodeIds: [] };
      return undefined;
    });

    const result = await invokeAndApprove("conv-upload-noinput", {
      file_path: "/tmp/resume.pdf",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("No <input");
  });

  it("a second upload on the SAME origin after one approval runs immediately", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (command === "DOM.querySelectorAll") return { nodeIds: [42] };
      if (command === "DOM.setFileInputFiles") return {};
      return undefined;
    });

    const conv = "conv-upload-regrant";
    await invokeAndApprove(conv, { file_path: "/tmp/a.pdf" });

    const runContext = { context: { conversationId: conv, tabId: TAB_ID } };
    const second = (await uploadFileToInputTool.invoke(
      runContext as any,
      JSON.stringify({ file_path: "/tmp/b.pdf" }),
    )) as any;

    expect(second.status).toBeUndefined();
    expect(second.success).toBe(true);
    expect(second.filename).toBe("b.pdf");
  });
});
