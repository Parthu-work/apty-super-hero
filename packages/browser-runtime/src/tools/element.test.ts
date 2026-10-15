import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFill = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockClick = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockInspectClickTarget = vi.hoisted(() => vi.fn());
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
      return { fill: mockFill, click: mockClick, hover: vi.fn() };
    }
  },
}));

vi.mock("./click-risk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./click-risk")>()),
  inspectClickTarget: mockInspectClickTarget,
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

import { resetApprovalStateForTests } from "./approval";
import { answerApprovals } from "./approval-test-utils";
import type { ClickTargetInfo } from "./click-risk";
import { clickTool, fillElementByUidTool, fillFormTool } from "./element";

function target(overrides: Partial<ClickTargetInfo> = {}): ClickTargetInfo {
  return {
    found: true,
    tagName: "button",
    role: "button",
    accessibleName: "Next page",
    typeAttribute: "button",
    insideForm: false,
    formAction: null,
    formMethod: null,
    href: null,
    documentUrl: "https://example.com/page",
    opaque: null,
    ...overrides,
  };
}

const TAB_ID = 7;

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  await resetApprovalStateForTests();
  mockGetSnapshot.mockReturnValue({ tabId: TAB_ID });
  mockGetSnapshotMode.mockResolvedValue("dom");
  mockGetNodeByUid.mockReturnValue({ uid: "n1" });
  mockFill.mockResolvedValue(undefined);
  mockClick.mockResolvedValue(undefined);
  mockInspectClickTarget.mockResolvedValue(target());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function invoke(
  tool: { invoke: (ctx: unknown, args: string) => Promise<unknown> },
  args: unknown,
): Promise<any> {
  const runContext = { context: { conversationId: "conv-1", tabId: TAB_ID } };
  return tool.invoke(runContext, JSON.stringify(args));
}

describe("fillElementByUidTool", () => {
  it("is denied without filling when no approval UI can show the request", async () => {
    const result = await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "hello",
    });

    expect(result).toMatchObject({
      status: "denied",
      reason: "no_approval_ui",
    });
    expect(mockFill).not.toHaveBeenCalled();
  });

  it("fills only after the user clicks Allow", async () => {
    const { requests } = answerApprovals({ approved: true });

    const result = await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "hello",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      toolName: "fill_element_by_uid",
      origin: "https://example.com",
    });
    expect(result).toMatchObject({ success: true });
    expect(mockFill).toHaveBeenCalledWith("hello");
  });

  it("never fills when the user clicks Deny", async () => {
    answerApprovals({ approved: false });

    const result = await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "hello",
    });

    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockFill).not.toHaveBeenCalled();
  });

  it("asks again on the next call unless the user chose to remember", async () => {
    const { requests } = answerApprovals({ approved: true });

    await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "a",
    });
    await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "b",
    });

    expect(requests).toHaveLength(2);
  });

  it("skips the prompt on the same origin after a remembered approval", async () => {
    const { requests } = answerApprovals({ approved: true, remember: true });

    await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "a",
    });
    const result = await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "b",
    });

    expect(requests).toHaveLength(1);
    expect(result).toMatchObject({ success: true });
    expect(mockFill).toHaveBeenLastCalledWith("b");
  });
});

describe("fillFormTool", () => {
  it("never fills without a decision", async () => {
    const result = await invoke(fillFormTool, {
      tabId: TAB_ID,
      elements: [{ uid: "n1", value: "a" }],
    });

    expect(result.status).toBe("denied");
    expect(mockFill).not.toHaveBeenCalled();
  });

  it("fills all elements once approved", async () => {
    answerApprovals({ approved: true });

    const result = await invoke(fillFormTool, {
      tabId: TAB_ID,
      elements: [
        { uid: "n1", value: "a" },
        { uid: "n1", value: "b" },
      ],
    });

    expect(result).toMatchObject({ success: true, successCount: 2 });
    expect(mockFill).toHaveBeenCalledTimes(2);
  });

  it("lists each field's label and value, truncated, in the prompt", async () => {
    mockGetNodeByUid.mockImplementation((_tab: number, uid: string) =>
      uid === "n1" ? { uid, role: "textbox", name: "Patient name" } : { uid, role: "textbox" },
    );
    const { requests } = answerApprovals({ approved: false });

    await invoke(fillFormTool, {
      tabId: TAB_ID,
      elements: [
        { uid: "n1", value: "Jane Testpatient" },
        { uid: "n2", value: "x".repeat(200) },
      ],
    });

    const summary = requests[0]?.summary ?? "";
    expect(summary).toContain('Patient name: "Jane Testpatient"');
    expect(summary).toContain(`textbox: "${"x".repeat(60)}…"`);
    expect(summary).not.toContain("x".repeat(61));
  });

  it("a remembered fill_element_by_uid grant does not cover fill_form", async () => {
    const { requests } = answerApprovals({ approved: true, remember: true });

    await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "a",
    });
    await invoke(fillFormTool, {
      tabId: TAB_ID,
      elements: [{ uid: "n1", value: "b" }],
    });

    expect(requests.map((r) => r.toolName)).toEqual([
      "fill_element_by_uid",
      "fill_form",
    ]);
  });
});

describe("clickTool", () => {
  it("clicks a safe control at once, with no prompt", async () => {
    const { requests } = answerApprovals({ approved: false });

    const result = await invoke(clickTool, { tabId: TAB_ID, uid: "n1" });

    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ success: true });
    expect(mockClick).toHaveBeenCalledWith({ count: 1 });
    expect(mockInspectClickTarget).toHaveBeenCalledWith(TAB_ID, { uid: "n1" });
  });

  it("asks before a Delete submit button, and Deny leaves it unclicked", async () => {
    mockInspectClickTarget.mockResolvedValue(
      target({
        accessibleName: "Delete",
        typeAttribute: "submit",
        insideForm: true,
        formAction: "https://example.com/orders/delete",
        formMethod: "post",
      }),
    );
    const { requests } = answerApprovals({ approved: false });

    const result = await invoke(clickTool, { tabId: TAB_ID, uid: "n1" });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      toolName: "click",
      origin: "https://example.com",
    });
    expect(requests[0]?.summary).toContain(
      "Form: POST https://example.com/orders/delete",
    );
    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockClick).not.toHaveBeenCalled();
  });

  it("asks before following a link to another origin", async () => {
    mockInspectClickTarget.mockResolvedValue(
      target({
        tagName: "a",
        role: "link",
        typeAttribute: null,
        accessibleName: "Read more",
        href: "https://elsewhere.example/?d=secret",
      }),
    );
    answerApprovals({ approved: true });

    const result = await invoke(clickTool, {
      tabId: TAB_ID,
      uid: "n1",
      dblClick: true,
    });

    expect(result).toMatchObject({ success: true });
    expect(mockClick).toHaveBeenCalledWith({ count: 2 });
  });

  it("asks when the element cannot be found in any frame", async () => {
    mockInspectClickTarget.mockResolvedValue({
      found: false,
      reason: "no element with that uid in any frame",
    });

    const result = await invoke(clickTool, { tabId: TAB_ID, uid: "n1" });

    expect(result).toMatchObject({
      status: "denied",
      reason: "no_approval_ui",
    });
    expect(mockClick).not.toHaveBeenCalled();
  });

  it("a remembered click grant does not cover fill_element_by_uid", async () => {
    mockInspectClickTarget.mockResolvedValue(
      target({ accessibleName: "Save", typeAttribute: "submit" }),
    );
    const { requests } = answerApprovals({ approved: true, remember: true });

    await invoke(clickTool, { tabId: TAB_ID, uid: "n1" });
    await invoke(clickTool, { tabId: TAB_ID, uid: "n1" });
    await invoke(fillElementByUidTool, {
      tabId: TAB_ID,
      uid: "n1",
      value: "x",
    });

    expect(requests.map((r) => r.toolName)).toEqual([
      "click",
      "fill_element_by_uid",
    ]);
  });
});
