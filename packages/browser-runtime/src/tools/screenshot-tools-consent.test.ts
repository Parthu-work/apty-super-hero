import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockConsent = vi.hoisted(() => vi.fn());
const mockGetActiveTab = vi.hoisted(() => vi.fn());
const mockCapture = vi.hoisted(() => vi.fn());
const mockTabsGet = vi.hoisted(() => vi.fn());

vi.mock("./screenshot-consent", () => ({
  gateScreenshotForModel: mockConsent,
}));
vi.mock("./tab-utils", () => ({ getActiveTab: mockGetActiveTab }));
vi.mock("../runtime/automation-mode", () => ({
  getAutomationMode: vi.fn(async () => "focus"),
}));

vi.stubGlobal("chrome", {
  tabs: { captureVisibleTab: mockCapture, get: mockTabsGet, update: vi.fn() },
  windows: { update: vi.fn() },
  scripting: { executeScript: vi.fn() },
});

import {
  captureScreenshotTool,
  captureScreenshotWithHighlightTool,
  captureTabScreenshotTool,
} from "./screenshot";

async function invoke(tool: unknown, args: unknown, conversationId = "conv") {
  const out = await (
    tool as { invoke: (ctx: unknown, input: string) => Promise<unknown> }
  ).invoke({ context: { conversationId } }, JSON.stringify(args));
  return typeof out === "string" ? JSON.parse(out) : out;
}

const denial = { status: "denied", toolName: "x", reason: "user_denied" };
const tab = { id: 4, windowId: 1, url: "https://ehr.example.com/a?b=c" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActiveTab.mockResolvedValue(tab);
  mockTabsGet.mockResolvedValue(tab);
  mockConsent.mockResolvedValue(denial);
  mockCapture.mockResolvedValue("not an image");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("screenshot tools ask before an image goes to the model", () => {
  it.each([
    ["capture_screenshot", captureScreenshotTool, { sendToLLM: true }],
    [
      "capture_tab_screenshot",
      captureTabScreenshotTool,
      { tabId: 4, sendToLLM: true },
    ],
    [
      "capture_screenshot_with_highlight",
      captureScreenshotWithHighlightTool,
      {},
    ],
  ])("%s returns the denial and captures nothing", async (name, tool, args) => {
    const result = await invoke(tool, args);
    expect(result).toEqual(denial);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockConsent).toHaveBeenCalledWith(
      { conversationId: "conv", toolName: name, tab },
      expect.any(Function),
    );
  });

  it("does not ask for a screenshot that stays on the device", async () => {
    await invoke(captureScreenshotTool, { sendToLLM: false }).catch(() => {});
    expect(mockConsent).not.toHaveBeenCalled();
    expect(mockCapture).toHaveBeenCalled();
  });
});
