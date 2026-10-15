import { beforeEach, describe, expect, it, vi } from "vitest";

const tabs = vi.hoisted(
  () =>
    new Map<
      number,
      { id: number; url: string; index: number; windowId: number }
    >(),
);

vi.mock("../runtime/automation-mode", () => ({
  getAutomationMode: vi.fn(async () => "focus"),
}));

let storageStore: Record<string, unknown> = {};

vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome = {
    tabs: {
      get: vi.fn(async (id: number) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error("No tab");
        return tab;
      }),
      query: vi.fn(async () => [tabs.get(2)]),
      create: vi.fn(async ({ url }: { url: string }) => {
        const tab = { id: 50 + tabs.size, url, index: 0, windowId: 1 };
        tabs.set(tab.id, tab);
        return tab;
      }),
      update: vi.fn(async (id: number) => tabs.get(id)),
      highlight: vi.fn(),
      remove: vi.fn(async (id: number) => {
        tabs.delete(id);
      }),
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
});

import { resetApprovalStateForTests } from "./approval";
import { answerApprovals } from "./approval-test-utils";
import { closeTabTool, createNewTabTool, switchToTabTool } from "./tab";

const BOUND = { conversationId: "conv-bound", tabId: 1 };

type ToolResult = { success?: boolean; status?: string; tabId?: number };

function call(
  tool: unknown,
  args: unknown,
  context: unknown = BOUND,
): Promise<ToolResult> {
  return (
    tool as { invoke: (ctx: unknown, input: string) => Promise<ToolResult> }
  ).invoke({ context }, JSON.stringify(args));
}

beforeEach(async () => {
  storageStore = {};
  tabs.clear();
  tabs.set(1, {
    id: 1,
    url: "https://bound.example.com/app",
    index: 0,
    windowId: 1,
  });
  tabs.set(2, {
    id: 2,
    url: "https://active.example.org/",
    index: 1,
    windowId: 1,
  });
  tabs.set(3, {
    id: 3,
    url: "https://bound.example.com/other",
    index: 2,
    windowId: 1,
  });
  await resetApprovalStateForTests();
});

describe("create_new_tab compares with the conversation's bound tab", () => {
  it("asks for the active tab's origin when it is not the bound tab's", async () => {
    const { requests, stop } = answerApprovals({ approved: false });
    await call(createNewTabTool, { url: "https://active.example.org/x" });
    stop();
    expect(requests).toHaveLength(1);
  });

  it("opens the bound tab's origin without asking", async () => {
    const { requests, stop } = answerApprovals({ approved: false });
    const result = await call(createNewTabTool, {
      url: "https://bound.example.com/next",
    });
    stop();
    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ success: true });
  });

  it("asks when there is no bound tab", async () => {
    const { requests, stop } = answerApprovals({ approved: false });
    await call(
      createNewTabTool,
      { url: "https://active.example.org/x" },
      { conversationId: "c" },
    );
    stop();
    expect(requests).toHaveLength(1);
  });
});

describe("switch_to_tab", () => {
  it("asks before switching to a tab on another origin", async () => {
    const { requests, stop } = answerApprovals({ approved: false });
    const result = await call(switchToTabTool, { tabId: 2 });
    stop();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.origin).toBe("https://active.example.org");
    expect(result).toMatchObject({ status: "denied" });
    expect(vi.mocked(chrome.tabs.update)).not.toHaveBeenCalled();
  });

  it("switches to a same-origin tab without asking", async () => {
    const { requests, stop } = answerApprovals({ approved: false });
    const result = await call(switchToTabTool, { tabId: 3 });
    stop();
    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ success: true });
  });
});

describe("close_tab", () => {
  it("closes a tab this conversation opened without asking", async () => {
    const opened = await call(createNewTabTool, {
      url: "https://bound.example.com/tmp",
    });
    const { requests, stop } = answerApprovals({ approved: false });
    const result = await call(closeTabTool, { tabId: opened.tabId });
    stop();
    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ success: true });
  });

  it("asks, without offering to remember, before closing any other tab", async () => {
    const { requests, stop } = answerApprovals({ approved: false });
    const result = await call(closeTabTool, { tabId: 3 });
    stop();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.rememberable).toBe(false);
    expect(result).toMatchObject({ status: "denied" });
    expect(tabs.has(3)).toBe(true);
  });

  it("asks before closing a tab another conversation opened", async () => {
    const opened = await call(createNewTabTool, {
      url: "https://bound.example.com/tmp",
    });
    const { requests, stop } = answerApprovals({ approved: false });
    await call(
      closeTabTool,
      { tabId: opened.tabId },
      { conversationId: "other", tabId: 1 },
    );
    stop();
    expect(requests).toHaveLength(1);
  });
});
