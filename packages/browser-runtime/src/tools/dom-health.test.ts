import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRecordToolCall = vi.hoisted(() => vi.fn());

vi.mock("../apty/index.js", () => ({
  runDomHealthAudit: mockRunDomHealthAudit,
  recordToolCall: mockRecordToolCall,
}));

(global as any).chrome = {
  tabs: {
    get: vi.fn(async (tabId: number) => ({ id: tabId })),
    query: vi.fn(async () => [{ id: 7 }]),
  },
};

import { runDomHealthAuditTool } from "./dom-health";

describe("runDomHealthAuditTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
    }));
    (global as any).chrome.tabs.query = vi.fn(async () => [{ id: 7 }]);
  });

  it("delegates to runDomHealthAudit for the tab bound to the conversation", async () => {
    mockRunDomHealthAudit.mockResolvedValue({ available: true, score: 88 });

    const runContext = { context: { conversationId: "conv-1", tabId: 9 } };
    const result = await runDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({}),
    );

    expect(mockRunDomHealthAudit).toHaveBeenCalledWith(9);
    expect(result).toEqual({ available: true, score: 88 });
    expect(mockRecordToolCall).toHaveBeenCalledWith(
      "conv-1",
      "run_dom_health_audit",
      {},
    );
  });

  it("falls back to the active tab when no tab is bound to the conversation", async () => {
    mockRunDomHealthAudit.mockResolvedValue({ available: true, score: 50 });
    const runContext = { context: { conversationId: "conv-2", tabId: null } };

    await runDomHealthAuditTool.invoke(runContext as any, JSON.stringify({}));

    expect(mockRunDomHealthAudit).toHaveBeenCalledWith(7);
  });

  it("returns the audit outcome exactly as computed — never a different score", async () => {
    const outcome = {
      available: true,
      score: 42,
      grade: "NEEDS_ATTENTION",
      risks: [{ id: "x", severity: "high", title: "t", evidence: "e" }],
    };
    mockRunDomHealthAudit.mockResolvedValue(outcome);

    const runContext = { context: { conversationId: "conv-3", tabId: 1 } };
    const result = await runDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({}),
    );

    expect(result).toEqual(outcome);
  });
});
