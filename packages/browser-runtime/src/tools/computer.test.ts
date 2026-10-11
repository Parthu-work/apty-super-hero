import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockExecuteComputerAction = vi.hoisted(() => vi.fn());
const mockGetAutomationMode = vi.hoisted(() => vi.fn());
const mockScreenshotPointToCss = vi.hoisted(() => vi.fn());
const mockInspectClickTarget = vi.hoisted(() => vi.fn());

vi.mock("../automation/computer", () => ({
  executeComputerAction: mockExecuteComputerAction,
  screenshotPointToCss: mockScreenshotPointToCss,
}));

vi.mock("./click-risk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./click-risk")>()),
  inspectClickTarget: mockInspectClickTarget,
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
import type { ClickTargetInfo } from "./click-risk";
import { computerTool } from "./computer";

function target(overrides: Partial<ClickTargetInfo> = {}): ClickTargetInfo {
  return {
    found: true,
    tagName: "button",
    role: "button",
    accessibleName: "Show details",
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

const DELETE_BUTTON = target({
  accessibleName: "Delete",
  typeAttribute: "submit",
  insideForm: true,
});

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  mockGetAutomationMode.mockResolvedValue("focus");
  mockExecuteComputerAction.mockResolvedValue({ success: true });
  mockScreenshotPointToCss.mockImplementation((_tabId, x, y) => ({
    xCss: x,
    yCss: y,
  }));
  mockInspectClickTarget.mockResolvedValue(target());
  await resetApprovalStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("computerTool — click and drag are gated only when risky", () => {
  it("left_click on a safe control runs immediately with no approval", async () => {
    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-click" } } as any,
      JSON.stringify({ action: "left_click", coordinate: [10, 20] }),
    )) as any;

    expect(result).toEqual({ success: true });
    expect(mockExecuteComputerAction).toHaveBeenCalledTimes(1);
    expect(mockInspectClickTarget).toHaveBeenCalledWith(7, { x: 10, y: 20 });
  });

  it("asks before clicking a Delete submit button, and Deny leaves it unclicked", async () => {
    mockInspectClickTarget.mockResolvedValue(DELETE_BUTTON);
    const { requests } = answerApprovals({ approved: false });

    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-delete" } } as any,
      JSON.stringify({ action: "left_click", coordinate: [10, 20] }),
    )) as any;

    expect(requests).toHaveLength(1);
    expect(requests[0]?.toolName).toBe("computer");
    expect(requests[0]?.summary).toContain('Click "Delete"');
    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockExecuteComputerAction).not.toHaveBeenCalled();
  });

  it("clicks the risky control once the user clicks Allow", async () => {
    mockInspectClickTarget.mockResolvedValue(DELETE_BUTTON);
    answerApprovals({ approved: true });

    const result = (await computerTool.invoke(
      { context: { conversationId: "conv-delete-ok" } } as any,
      JSON.stringify({ action: "double_click", coordinate: [10, 20] }),
    )) as any;

    expect(result).toEqual({ success: true });
    expect(mockExecuteComputerAction).toHaveBeenCalledTimes(1);
  });

  it("asks when the point cannot be mapped without a screenshot", async () => {
    mockScreenshotPointToCss.mockReturnValue(null);
    const { requests } = answerApprovals({ approved: false });

    await computerTool.invoke(
      { context: { conversationId: "conv-no-shot" } } as any,
      JSON.stringify({ action: "right_click", coordinate: [10, 20] }),
    );

    expect(requests[0]?.summary).toContain("could not be identified");
    expect(mockInspectClickTarget).not.toHaveBeenCalled();
    expect(mockExecuteComputerAction).not.toHaveBeenCalled();
  });

  it("checks both ends of a drag", async () => {
    mockInspectClickTarget
      .mockResolvedValueOnce(target())
      .mockResolvedValueOnce(target({ opaque: "canvas", tagName: "canvas" }));
    const { requests } = answerApprovals({ approved: false });

    await computerTool.invoke(
      { context: { conversationId: "conv-drag" } } as any,
      JSON.stringify({
        action: "left_click_drag",
        start_coordinate: [1, 2],
        coordinate: [30, 40],
      }),
    );

    expect(mockInspectClickTarget).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.summary).toContain("canvas");
    expect(mockExecuteComputerAction).not.toHaveBeenCalled();
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
