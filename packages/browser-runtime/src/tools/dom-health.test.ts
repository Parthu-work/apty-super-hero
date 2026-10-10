import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRunApplicationDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRecordToolCall = vi.hoisted(() => vi.fn());

vi.mock("../apty/index.js", () => ({
  runDomHealthAudit: mockRunDomHealthAudit,
  runApplicationDomHealthAudit: mockRunApplicationDomHealthAudit,
  recordToolCall: mockRecordToolCall,
}));

(global as any).chrome = {
  tabs: {
    get: vi.fn(async (tabId: number) => ({ id: tabId })),
    query: vi.fn(async () => [{ id: 7 }]),
  },
};

import {
  runApplicationDomHealthAuditTool,
  runDomHealthAuditTool,
} from "./dom-health";

describe("runDomHealthAuditTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
    }));
    (global as any).chrome.tabs.query = vi.fn(async () => [{ id: 7 }]);
  });

  it("delegates to runDomHealthAudit for the tab bound to the conversation, and adds a tab meta block", async () => {
    mockRunDomHealthAudit.mockResolvedValue({ available: true, score: 88 });

    const runContext = { context: { conversationId: "conv-1", tabId: 9 } };
    const result = await runDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({}),
    );

    expect(mockRunDomHealthAudit).toHaveBeenCalledWith(9, { ignoredRoots: [] });
    expect(result).toEqual({
      available: true,
      score: 88,
      meta: { tab: { id: 9, origin: null, title: null } },
    });
    expect(mockRecordToolCall).toHaveBeenCalledWith(
      "conv-1",
      "run_dom_health_audit",
      {},
    );
  });

  it("never silently uses the active tab when no tab is bound to the conversation — returns no_bound_tab instead", async () => {
    const runContext = { context: { conversationId: "conv-2", tabId: null } };

    const result = await runDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({}),
    );

    expect(mockRunDomHealthAudit).not.toHaveBeenCalled();
    expect((global as any).chrome.tabs.query).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: false,
      status: expect.objectContaining({ code: "no_bound_tab" }),
    });
  });

  it("returns bound_tab_closed (never the active tab) when the bound tab has been closed", async () => {
    (global as any).chrome.tabs.get = vi.fn(async () => {
      throw new Error("No tab with id: 9");
    });
    const runContext = { context: { conversationId: "conv-4", tabId: 9 } };

    const result = await runDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({}),
    );

    expect(mockRunDomHealthAudit).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: false,
      status: expect.objectContaining({ code: "bound_tab_closed" }),
    });
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

    expect(result).toEqual({
      ...outcome,
      meta: { tab: { id: 1, origin: null, title: null } },
    });
  });
});

describe("runApplicationDomHealthAuditTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
    }));
    (global as any).chrome.tabs.query = vi.fn(async () => [{ id: 7 }]);
  });

  it("delegates to runApplicationDomHealthAudit for the tab bound to the conversation, forwarding maxPages", async () => {
    mockRunApplicationDomHealthAudit.mockResolvedValue({
      available: true,
      scope: "application",
      score: 70,
    });

    const runContext = { context: { conversationId: "conv-1", tabId: 9 } };
    const result = await runApplicationDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({ maxPages: 5 }),
    );

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(9, {
      maxPages: 5,
      ignoredRoots: [],
    });
    expect(result).toEqual({
      available: true,
      scope: "application",
      score: 70,
      meta: { tab: { id: 9, origin: null, title: null } },
    });
    expect(mockRecordToolCall).toHaveBeenCalledWith(
      "conv-1",
      "run_application_dom_health_audit",
      { maxPages: 5 },
    );
  });

  it("forwards an explicit discoveryMode through to runApplicationDomHealthAudit, never silently defaulting to a deeper scope than requested", async () => {
    mockRunApplicationDomHealthAudit.mockResolvedValue({
      available: true,
      scope: "page",
      score: 80,
    });

    const runContext = { context: { conversationId: "conv-3", tabId: 11 } };
    await runApplicationDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({ discoveryMode: "page" }),
    );

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(11, {
      maxPages: undefined,
      discoveryMode: "page",
      ignoredRoots: [],
    });
  });

  it("leaves out the overlays the user added in Settings", async () => {
    mockRunApplicationDomHealthAudit.mockResolvedValue({ available: true });
    (global as any).chrome.storage = {
      local: {
        get: vi.fn(async (key: string) => ({
          [key]: { domHealthIgnoredRoots: ["tag:support-widget"] },
        })),
      },
    };

    try {
      await runApplicationDomHealthAuditTool.invoke(
        { context: { conversationId: "conv-4", tabId: 11 } } as any,
        JSON.stringify({}),
      );
    } finally {
      delete (global as any).chrome.storage;
    }

    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ ignoredRoots: ["tag:support-widget"] }),
    );
  });

  it("never silently uses the active tab when no tab is bound to the conversation", async () => {
    const runContext = { context: { conversationId: "conv-5", tabId: null } };

    const result = await runApplicationDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({}),
    );

    expect(mockRunApplicationDomHealthAudit).not.toHaveBeenCalled();
    expect(result).toEqual({
      available: false,
      status: expect.objectContaining({ code: "no_bound_tab" }),
    });
  });

  it("returns the application audit outcome exactly as computed", async () => {
    const outcome = {
      available: true,
      scope: "page",
      score: 55,
      coverage: { pagesDiscovered: 1, pagesAudited: 1 },
    };
    mockRunApplicationDomHealthAudit.mockResolvedValue(outcome);

    const runContext = { context: { conversationId: "conv-2", tabId: 3 } };
    const result = await runApplicationDomHealthAuditTool.invoke(
      runContext as any,
      JSON.stringify({}),
    );

    expect(result).toEqual({
      ...outcome,
      meta: { tab: { id: 3, origin: null, title: null } },
    });
  });
});
