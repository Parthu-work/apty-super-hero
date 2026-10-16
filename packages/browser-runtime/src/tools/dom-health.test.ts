import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRunDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRunApplicationDomHealthAudit = vi.hoisted(() => vi.fn());
const mockRecordToolCall = vi.hoisted(() => vi.fn());

vi.mock("../apty/index.js", () => ({
  DEFAULT_APPLICATION_MAX_PAGES: 15,
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

import { resetApprovalStateForTests } from "./approval";
import { answerApprovals } from "./approval-test-utils";
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
  // Application runs now ask first; these tests are about what runs after.
  let stopApprovals: () => void;
  beforeEach(() => {
    vi.clearAllMocks();
    (global as any).chrome.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
    }));
    (global as any).chrome.tabs.query = vi.fn(async () => [{ id: 7 }]);
    stopApprovals = answerApprovals({ approved: true }).stop;
  });
  afterEach(() => stopApprovals());

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

  it.each([
    [true, { sameUrlRatioForClickFirst: 0.4 }],
    [false, undefined],
  ])("applies the threshold overrides only with Developer tools on (%s)", async (developerTools, expected) => {
    mockRunApplicationDomHealthAudit.mockResolvedValue({ available: true });
    (global as any).chrome.storage = {
      local: {
        get: vi.fn(async (key: string) => ({
          [key]: {
            developerTools,
            domHealthThresholdOverrides: { sameUrlRatioForClickFirst: 0.4 },
          },
        })),
      },
    };

    try {
      await runApplicationDomHealthAuditTool.invoke(
        { context: { conversationId: "conv-6", tabId: 11 } } as any,
        JSON.stringify({}),
      );
    } finally {
      delete (global as any).chrome.storage;
    }

    expect(mockRunApplicationDomHealthAudit.mock.calls[0]?.[1]).toMatchObject({
      thresholdOverrides: expected,
    });
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

type ChromeMock = {
  tabs: { get: unknown };
  storage?: unknown;
};

describe("runApplicationDomHealthAuditTool — clicking discovery needs approval", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const chromeMock = (globalThis as unknown as { chrome: ChromeMock }).chrome;
    chromeMock.tabs.get = vi.fn(async (tabId: number) => ({
      id: tabId,
      url: "https://app.example.com/home",
    }));
    mockRunApplicationDomHealthAudit.mockResolvedValue({ available: true });
    const store: Record<string, unknown> = {};
    chromeMock.storage = {
      local: {
        get: async (key: string) => ({ [key]: store[key] }),
        set: async (items: Record<string, unknown>) =>
          Object.assign(store, items),
      },
    };
    await resetApprovalStateForTests();
  });

  function deepRun(args: Record<string, unknown> = {}) {
    return runApplicationDomHealthAuditTool.invoke(
      { context: { conversationId: "conv-deep", tabId: 12 } } as never,
      JSON.stringify({ discoveryMode: "application-deep", ...args }),
    );
  }

  it("asks once per run, naming the mode and the page limit, and never remembers", async () => {
    const { requests, stop } = answerApprovals({
      approved: true,
      remember: true,
    });
    await deepRun({ maxPages: 20 });
    await deepRun();
    stop();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.summary).toContain("application-deep");
    expect(requests[0]?.summary).toContain("20 pages");
    expect(requests[1]?.summary).toContain("15 pages");
    expect(requests[0]?.rememberable).toBe(false);
    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledTimes(2);
  });

  it("does not run when the user denies", async () => {
    const { stop } = answerApprovals({ approved: false });
    const result = await deepRun();
    stop();
    expect(result).toMatchObject({ status: "denied" });
    expect(mockRunApplicationDomHealthAudit).not.toHaveBeenCalled();
  });

  it("asks before link-only discovery too, which may be remembered for the site", async () => {
    const { requests, stop } = answerApprovals({
      approved: true,
      remember: true,
    });
    const safeRun = () =>
      runApplicationDomHealthAuditTool.invoke(
        { context: { conversationId: "conv-safe", tabId: 12 } } as never,
        JSON.stringify({ discoveryMode: "application-safe", maxPages: 4 }),
      );
    await safeRun();
    await safeRun();
    stop();

    expect(requests).toHaveLength(1);
    expect(requests[0]?.summary).toContain("application-safe");
    expect(requests[0]?.summary).toContain("4 pages");
    expect(requests[0]?.summary).toMatch(/links/);
    expect(requests[0]?.rememberable).not.toBe(false);
    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledTimes(2);
  });

  it("runs page-only discovery, which navigates nowhere, without asking", async () => {
    const { requests, stop } = answerApprovals({ approved: false });
    await runApplicationDomHealthAuditTool.invoke(
      { context: { conversationId: "conv-page", tabId: 12 } } as never,
      JSON.stringify({ discoveryMode: "page" }),
    );
    stop();
    expect(requests).toHaveLength(0);
    expect(mockRunApplicationDomHealthAudit).toHaveBeenCalledOnce();
  });
});
