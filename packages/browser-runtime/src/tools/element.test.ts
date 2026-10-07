import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFill = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockGetSnapshot = vi.hoisted(() => vi.fn());
const mockCreateSnapshot = vi.hoisted(() => vi.fn());
const mockGetNodeByUid = vi.hoisted(() => vi.fn());
const mockGetSnapshotMode = vi.hoisted(() => vi.fn());

vi.mock("../automation/snapshot-provider", () => ({
  getSnapshot: mockGetSnapshot,
  createSnapshot: mockCreateSnapshot,
  getNodeByUid: mockGetNodeByUid,
  getSnapshotMode: mockGetSnapshotMode,
}));

vi.mock("../automation/dom-element-handle", () => ({
  DomElementHandle: class {
    dispose = vi.fn();
    asLocator() {
      return { fill: mockFill, click: vi.fn(), hover: vi.fn() };
    }
  },
}));

vi.mock("./ui-operations", () => ({
  playClickAnimationAndReturn: vi.fn().mockResolvedValue(undefined),
  scrollAndMoveFakeMouseToElement: vi.fn().mockResolvedValue(undefined),
  waitForEventsAfterAction: async (fn: () => Promise<void>) => fn(),
}));

let storageStore: Record<string, unknown> = {};

(global as any).chrome = {
  tabs: {
    get: vi.fn(async (tabId: number) => ({
      id: tabId,
      url: "https://example.com/page",
    })),
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

import { confirmRiskyAction, resetApprovalStateForTests } from "./approval";
import { fillElementByUidTool, fillFormTool } from "./element";

const TAB_ID = 7;

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  await resetApprovalStateForTests();
  mockGetSnapshot.mockReturnValue({ tabId: TAB_ID });
  mockGetSnapshotMode.mockResolvedValue("dom");
  mockGetNodeByUid.mockReturnValue({ uid: "n1" });
  mockFill.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Invoke a gated tool, confirm the resulting pending approval, and return the EXECUTED result. */
async function invokeAndApprove(
  tool: { invoke: (ctx: unknown, args: string) => Promise<unknown> },
  conversationId: string,
  args: unknown,
): Promise<any> {
  const runContext = { context: { conversationId, tabId: TAB_ID } };
  const pending = (await tool.invoke(runContext, JSON.stringify(args))) as any;
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

describe("fillElementByUidTool", () => {
  it("never fills on the first call — always returns a pending approval", async () => {
    const runContext = {
      context: { conversationId: "conv-fill-gate", tabId: TAB_ID },
    };
    const result = (await fillElementByUidTool.invoke(
      runContext as any,
      JSON.stringify({ tabId: TAB_ID, uid: "n1", value: "hello" }),
    )) as any;

    expect(result.status).toBe("needs_approval");
    expect(mockFill).not.toHaveBeenCalled();
  });

  it("fills the element once approved", async () => {
    const result = await invokeAndApprove(fillElementByUidTool, "conv-fill-1", {
      tabId: TAB_ID,
      uid: "n1",
      value: "hello",
    });

    expect(result).toMatchObject({ success: true });
    expect(mockFill).toHaveBeenCalledWith("hello");
  });

  it("denying never fills", async () => {
    const runContext = {
      context: { conversationId: "conv-fill-deny", tabId: TAB_ID },
    };
    const pending = (await fillElementByUidTool.invoke(
      runContext as any,
      JSON.stringify({ tabId: TAB_ID, uid: "n1", value: "hello" }),
    )) as any;

    const confirmed = await confirmRiskyAction(
      "conv-fill-deny",
      pending.approvalId,
      false,
    );
    expect(confirmed.denied).toBe(true);
    expect(mockFill).not.toHaveBeenCalled();
  });

  it("second call on the same origin runs immediately — no re-approval", async () => {
    await invokeAndApprove(fillElementByUidTool, "conv-fill-2", {
      tabId: TAB_ID,
      uid: "n1",
      value: "first",
    });

    const runContext = {
      context: { conversationId: "conv-fill-2", tabId: TAB_ID },
    };
    const result = (await fillElementByUidTool.invoke(
      runContext as any,
      JSON.stringify({ tabId: TAB_ID, uid: "n1", value: "second" }),
    )) as any;

    expect(result).toMatchObject({ success: true });
    expect(mockFill).toHaveBeenLastCalledWith("second");
  });
});

describe("fillFormTool", () => {
  it("never fills on the first call — always returns a pending approval", async () => {
    const runContext = {
      context: { conversationId: "conv-form-gate", tabId: TAB_ID },
    };
    const result = (await fillFormTool.invoke(
      runContext as any,
      JSON.stringify({
        tabId: TAB_ID,
        elements: [{ uid: "n1", value: "a" }],
      }),
    )) as any;

    expect(result.status).toBe("needs_approval");
    expect(mockFill).not.toHaveBeenCalled();
  });

  it("fills all elements once approved", async () => {
    const result = await invokeAndApprove(fillFormTool, "conv-form-1", {
      tabId: TAB_ID,
      elements: [
        { uid: "n1", value: "a" },
        { uid: "n1", value: "b" },
      ],
    });

    expect(result).toMatchObject({ success: true, successCount: 2 });
    expect(mockFill).toHaveBeenCalledTimes(2);
  });
});
