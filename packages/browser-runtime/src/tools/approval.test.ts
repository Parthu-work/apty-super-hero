import { STORAGE_KEYS } from "@apty/agent-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let storageStore: Record<string, unknown> = {};
const onMessageListeners: Array<
  (message: unknown, sender: chrome.runtime.MessageSender) => unknown
> = [];
const mockSendMessage = vi.fn();

(global as any).chrome = {
  runtime: {
    id: "agent-extension-id",
    sendMessage: mockSendMessage,
    onMessage: {
      addListener: (listener: (typeof onMessageListeners)[number]) =>
        onMessageListeners.push(listener),
    },
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

import {
  APPROVAL_DECISION_MESSAGE,
  APPROVAL_REQUEST_MESSAGE,
  APPROVAL_TTL_MS,
  type ApprovalRequest,
  GRANT_TTL_MS,
  gateRiskyAction,
  getPendingApprovals,
  listApprovalGrants,
  resetApprovalStateForTests,
  revokeAllApprovalGrants,
  revokeApprovalGrant,
} from "./approval";
import { answerApprovals } from "./approval-test-utils";

const PAGE = "https://app.example.com/dashboard";

function relayedRequest(): ApprovalRequest {
  const call = mockSendMessage.mock.calls.find(
    ([message]) => message.type === APPROVAL_REQUEST_MESSAGE,
  );
  return call?.[0].request;
}

function deliverDecision(
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
) {
  for (const listener of onMessageListeners) listener(message, sender);
}

beforeEach(async () => {
  vi.clearAllMocks();
  storageStore = {};
  mockSendMessage.mockResolvedValue(undefined);
  await resetApprovalStateForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("gateRiskyAction", () => {
  it("fails closed when no extension page can show the request", async () => {
    mockSendMessage.mockRejectedValue(
      new Error("Receiving end does not exist."),
    );
    const run = vi.fn();

    const result = await gateRiskyAction("c", "tool_a", "do it", PAGE, run);

    expect(result).toMatchObject({
      status: "denied",
      reason: "no_approval_ui",
    });
    expect(run).not.toHaveBeenCalled();
    expect(getPendingApprovals()).toEqual([]);
  });

  it("expires an unanswered request without running it", async () => {
    vi.useFakeTimers();
    const run = vi.fn();

    const pending = gateRiskyAction("c", "tool_a", "do it", PAGE, run);
    await vi.advanceTimersByTimeAsync(APPROVAL_TTL_MS + 1);

    await expect(pending).resolves.toMatchObject({ reason: "expired" });
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts a decision relayed from the extension's own side panel", async () => {
    const run = vi.fn().mockResolvedValue("ran");

    const pending = gateRiskyAction("c", "tool_a", "do it", PAGE, run);
    await vi.waitFor(() => expect(relayedRequest()).toBeDefined());
    deliverDecision(
      {
        type: APPROVAL_DECISION_MESSAGE,
        approvalId: relayedRequest().approvalId,
        approved: true,
      },
      {
        id: "agent-extension-id",
        url: "chrome-extension://agent-extension-id/src/entrypoints/sidepanel/index.html",
      },
    );

    await expect(pending).resolves.toBe("ran");
  });

  it.each([
    [
      "a content script in a web page",
      {
        id: "agent-extension-id",
        tab: { id: 1 } as chrome.tabs.Tab,
        url: "https://app.example.com/dashboard",
      },
    ],
    ["another extension", { id: "other-extension" }],
  ])("ignores a decision sent by %s", async (_label, sender) => {
    vi.useFakeTimers();
    const run = vi.fn();

    const pending = gateRiskyAction("c", "tool_a", "do it", PAGE, run);
    await vi.waitFor(() => expect(relayedRequest()).toBeDefined());
    deliverDecision(
      {
        type: APPROVAL_DECISION_MESSAGE,
        approvalId: relayedRequest().approvalId,
        approved: true,
      },
      sender,
    );
    await vi.advanceTimersByTimeAsync(APPROVAL_TTL_MS + 1);

    await expect(pending).resolves.toMatchObject({ reason: "expired" });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("approval grants", () => {
  it("are scoped to one tool on one origin", async () => {
    const { requests } = answerApprovals((request) =>
      request.toolName === "tool_a" &&
      request.origin === "https://app.example.com"
        ? { approved: true, remember: true }
        : { approved: false },
    );
    await gateRiskyAction("c", "tool_a", "x", PAGE, vi.fn());
    await gateRiskyAction("c", "tool_a", "x", PAGE, vi.fn());

    const sameToolOtherOrigin = await gateRiskyAction(
      "c",
      "tool_a",
      "x",
      "https://other.example.com/",
      vi.fn(),
    );
    const otherToolSameOrigin = await gateRiskyAction(
      "c",
      "tool_b",
      "x",
      PAGE,
      vi.fn(),
    );

    expect(requests).toHaveLength(3);
    expect(sameToolOtherOrigin).toMatchObject({ status: "denied" });
    expect(otherToolSameOrigin).toMatchObject({ status: "denied" });
  });

  it("expire after the grant TTL", async () => {
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now);
    const { requests, stop } = answerApprovals({
      approved: true,
      remember: true,
    });
    await gateRiskyAction("c", "tool_a", "x", PAGE, vi.fn());
    expect(await listApprovalGrants()).toHaveLength(1);

    spy.mockReturnValue(now + GRANT_TTL_MS + 1);

    expect(await listApprovalGrants()).toEqual([]);
    await gateRiskyAction("c", "tool_a", "x", PAGE, vi.fn());
    stop();
    expect(requests).toHaveLength(2);
  });

  it("can be revoked individually or all at once", async () => {
    const { stop } = answerApprovals({ approved: true, remember: true });
    await gateRiskyAction("c", "tool_a", "x", PAGE, vi.fn());
    await gateRiskyAction("c", "tool_b", "x", PAGE, vi.fn());
    stop();

    await revokeApprovalGrant("tool_a", "https://app.example.com");
    expect((await listApprovalGrants()).map((g) => g.toolName)).toEqual([
      "tool_b",
    ]);

    await revokeAllApprovalGrants();
    expect(await listApprovalGrants()).toEqual([]);
  });

  it("ignores grants stored in the old permanent per-origin format", async () => {
    storageStore[STORAGE_KEYS.RISKY_ORIGIN_GRANTS] = [
      "https://app.example.com",
    ];

    expect(await listApprovalGrants()).toEqual([]);
    const { requests } = answerApprovals({ approved: false });
    const run = vi.fn();
    await gateRiskyAction("c", "tool_a", "x", PAGE, run);
    expect(requests).toHaveLength(1);
    expect(run).not.toHaveBeenCalled();
  });
});
