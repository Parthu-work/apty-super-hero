import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetAutomationMode = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("../runtime/automation-mode", () => ({
  getAutomationMode: mockGetAutomationMode,
}));

const CURRENT_PAGE = "https://app.example.com/orders";
let storageStore: Record<string, unknown> = {};

(global as any).chrome = {
  tabs: {
    create: mockCreate,
    query: vi.fn(async () => [{ id: 3, url: CURRENT_PAGE }]),
    get: vi.fn(async (tabId: number) => ({ id: tabId, url: CURRENT_PAGE })),
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
import { createNewTabTool } from "./tab";

function open(url: string): Promise<any> {
  return createNewTabTool.invoke(
    { context: { conversationId: "conv-tab", tabId: 3 } } as any,
    JSON.stringify({ url }),
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  mockGetAutomationMode.mockResolvedValue("focus");
  mockCreate.mockImplementation(async ({ url }) => ({ id: 9, url }));
  await resetApprovalStateForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("create_new_tab", () => {
  it("opens a same-origin page at once", async () => {
    const { requests } = answerApprovals({ approved: false });

    const result = await open(`${CURRENT_PAGE}/42`);

    expect(requests).toHaveLength(0);
    expect(result).toMatchObject({ success: true, tabId: 9 });
  });

  it("never opens another origin when the user clicks Deny", async () => {
    const { requests } = answerApprovals({ approved: false });

    const result = await open("https://docs.example.org/help");

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      toolName: "create_new_tab",
      origin: "https://docs.example.org",
    });
    expect(requests[0]?.summary).toContain("https://docs.example.org/help");
    expect(requests[0]?.rememberable).toBeUndefined();
    expect(result).toMatchObject({ status: "denied", reason: "user_denied" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("remembers a grant for the destination origin only", async () => {
    const { requests } = answerApprovals({ approved: true, remember: true });

    await open("https://docs.example.org/a");
    await open("https://docs.example.org/b");
    await open("https://other.example.net/");

    expect(requests.map((r) => r.origin)).toEqual([
      "https://docs.example.org",
      "https://other.example.net",
    ]);
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });

  it("always asks, without offering to remember, for a URL carrying a long query", async () => {
    const secret = "s".repeat(200);
    const { requests } = answerApprovals({ approved: true, remember: true });

    await open(`https://docs.example.org/?d=${secret}`);
    await open(`https://docs.example.org/?d=${secret}`);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.rememberable).toBe(false);
    expect(requests[0]?.summary).toContain(secret);
  });

  it("always asks for a long query even on the current origin", async () => {
    const { requests } = answerApprovals({ approved: false });

    await open(`${CURRENT_PAGE}?d=${"s".repeat(200)}`);

    expect(requests).toHaveLength(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
