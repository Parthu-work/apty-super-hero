import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGate = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());

vi.mock("./approval.js", () => ({ gateRiskyAction: mockGate }));

vi.stubGlobal("chrome", { storage: { local: { get: mockGet } } });

import {
  gateScreenshotForModel,
  getScreenshotPolicy,
  parseScreenshotPolicy,
} from "./screenshot-consent";

const tab = { id: 9, url: "https://ehr.example.com/chart/42?mrn=123" };

function storedPolicy(policy: unknown) {
  mockGet.mockResolvedValue({ apty_settings: { screenshotPolicy: policy } });
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("screenshot policy", () => {
  it("parses the three policies and treats anything else as ask", () => {
    expect(parseScreenshotPolicy("allow")).toBe("allow");
    expect(parseScreenshotPolicy("never")).toBe("never");
    expect(parseScreenshotPolicy("ask")).toBe("ask");
    expect(parseScreenshotPolicy(undefined)).toBe("ask");
    expect(parseScreenshotPolicy("yes")).toBe("ask");
  });

  it("reads the stored setting on every call, so a change applies at once", async () => {
    storedPolicy("never");
    expect(await getScreenshotPolicy()).toBe("never");
    storedPolicy("allow");
    expect(await getScreenshotPolicy()).toBe("allow");
  });

  it("is ask when settings cannot be read", async () => {
    mockGet.mockRejectedValue(new Error("no storage"));
    expect(await getScreenshotPolicy()).toBe("ask");
  });
});

describe("gateScreenshotForModel", () => {
  const capture = vi.fn(async () => ({ success: true, imageData: "data:x" }));

  it("asks through the approval gate, naming only the site", async () => {
    storedPolicy("ask");
    mockGate.mockImplementation(async (_c, _t, _s, _u, run) => run());
    const result = await gateScreenshotForModel(
      { conversationId: "conv", toolName: "capture_screenshot", tab },
      capture,
    );
    expect(result).toEqual({ success: true, imageData: "data:x" });
    const [conversationId, toolName, summary, pageUrl, , options] = mockGate
      .mock.calls[0] as unknown[];
    expect(conversationId).toBe("conv");
    expect(toolName).toBe("capture_screenshot");
    expect(summary).toContain("https://ehr.example.com");
    expect(summary).not.toContain("mrn");
    expect(pageUrl).toBe(tab.url);
    expect(options).toEqual({ tabId: 9 });
  });

  it("returns the gate's denial without capturing", async () => {
    storedPolicy("ask");
    const denial = { status: "denied", reason: "user_denied" };
    mockGate.mockResolvedValue(denial);
    capture.mockClear();
    const result = await gateScreenshotForModel(
      { conversationId: "conv", toolName: "capture_screenshot", tab },
      capture,
    );
    expect(result).toBe(denial);
    expect(capture).not.toHaveBeenCalled();
  });

  it("captures without asking when allowed", async () => {
    storedPolicy("allow");
    const result = await gateScreenshotForModel(
      { toolName: "capture_tab_screenshot", tab },
      capture,
    );
    expect(result).toEqual({ success: true, imageData: "data:x" });
    expect(mockGate).not.toHaveBeenCalled();
  });

  it("refuses without capturing or asking when set to never", async () => {
    storedPolicy("never");
    capture.mockClear();
    const result = await gateScreenshotForModel(
      { toolName: "capture_screenshot", tab },
      capture,
    );
    expect(result).toMatchObject({
      success: false,
      status: "refused",
      toolName: "capture_screenshot",
    });
    expect(JSON.stringify(result)).toMatch(/search_elements/);
    expect(capture).not.toHaveBeenCalled();
    expect(mockGate).not.toHaveBeenCalled();
  });
});
