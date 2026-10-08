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

import { resetApprovalStateForTests } from "../../approval";
import { answerApprovals } from "../../approval-test-utils";
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

function invoke(conversationId: string, args: Record<string, unknown>) {
  const runContext = { context: { conversationId, tabId: TAB_ID } };
  return uploadFileToInputTool.invoke(
    runContext as any,
    JSON.stringify(args),
  ) as Promise<any>;
}

function invokeAndApprove(
  conversationId: string,
  args: Record<string, unknown>,
): Promise<any> {
  answerApprovals({ approved: true });
  return invoke(conversationId, args);
}

describe("uploadFileToInputTool", () => {
  it("never writes the file without a human decision", async () => {
    const result = await invoke("conv-upload-gate", {
      file_path: "/tmp/resume.pdf",
    });

    expect(result.status).toBe("denied");
    expect(mockSendCommand).not.toHaveBeenCalled();
    expect(mockSafeAttachDebugger).not.toHaveBeenCalled();
  });

  it("denying the approval never touches the page", async () => {
    answerApprovals({ approved: false });

    const result = await invoke("conv-upload-deny", {
      file_path: "/tmp/resume.pdf",
    });

    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
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

  it("a remembered approval lets the next upload on the same origin run without a prompt", async () => {
    mockSendCommand.mockImplementation(async (command: string) => {
      if (command === "DOM.getDocument") return { root: { nodeId: 1 } };
      if (command === "DOM.querySelectorAll") return { nodeIds: [42] };
      if (command === "DOM.setFileInputFiles") return {};
      return undefined;
    });
    const { requests, stop } = answerApprovals({
      approved: true,
      remember: true,
    });
    await invoke("conv-upload-regrant", { file_path: "/tmp/a.pdf" });
    stop();

    const second = await invoke("conv-upload-regrant", {
      file_path: "/tmp/b.pdf",
    });

    expect(requests).toHaveLength(1);
    expect(second.success).toBe(true);
    expect(second.filename).toBe("b.pdf");
  });
});
