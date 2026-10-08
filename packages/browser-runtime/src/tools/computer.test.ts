import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecuteComputerAction = vi.hoisted(() => vi.fn());
const mockGetAutomationMode = vi.hoisted(() => vi.fn());

vi.mock("../automation/computer", () => ({
  executeComputerAction: mockExecuteComputerAction,
}));

vi.mock("../runtime/automation-mode", () => ({
  getAutomationMode: mockGetAutomationMode,
}));

let storageStore: Record<string, unknown> = {};

(global as any).chrome = {
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
import { computerTool } from "./computer";

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  mockGetAutomationMode.mockResolvedValue("focus");
  mockExecuteComputerAction.mockResolvedValue({ success: true });
  await resetApprovalStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computerTool — pointer actions are not gated", () => {
  it("left_click runs immediately with no approval", async () => {
    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-click" } } as any,
      JSON.stringify({ action: "left_click", coordinate: [10, 20] }),
    )) as any;

    expect(result).toEqual({ success: true });
    expect(mockExecuteComputerAction).toHaveBeenCalledTimes(1);
  });

  it("scroll runs immediately with no approval", async () => {
    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-scroll" } } as any,
      JSON.stringify({ action: "scroll", coordinate: [10, 20] }),
    )) as any;

    expect(result).toEqual({ success: true });
    expect(mockExecuteComputerAction).toHaveBeenCalledTimes(1);
  });
});

describe("computerTool — type/key actions are gated", () => {
  it("never types without a human decision", async () => {
    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-type-gate" } } as any,
      JSON.stringify({ action: "type", text: "hello" }),
    )) as any;

    expect(result.status).toBe("denied");
    expect(mockExecuteComputerAction).not.toHaveBeenCalled();
  });

  it("types once the user clicks Allow", async () => {
    const { requests } = answerApprovals({ approved: true });

    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-type-1" } } as any,
      JSON.stringify({ action: "type", text: "hello" }),
    )) as any;

    expect(requests).toHaveLength(1);
    expect(result).toEqual({ success: true });
    expect(mockExecuteComputerAction).toHaveBeenCalledTimes(1);
  });

  it("never presses a key when the user clicks Deny", async () => {
    answerApprovals({ approved: false });

    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-key-gate" } } as any,
      JSON.stringify({ action: "key", text: "Enter" }),
    )) as any;

    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockExecuteComputerAction).not.toHaveBeenCalled();
  });
});

describe("computerTool — background mode", () => {
  it("rejects even a non-gated action in background mode", async () => {
    mockGetAutomationMode.mockResolvedValue("background");

    const result = await computerTool.invoke(
      { context: { conversationId: "conv-bg" } } as any,
      JSON.stringify({ action: "left_click", coordinate: [1, 2] }),
    );

    expect(String(result)).toMatch(/background mode/i);
    expect(mockExecuteComputerAction).not.toHaveBeenCalled();
  });
});
