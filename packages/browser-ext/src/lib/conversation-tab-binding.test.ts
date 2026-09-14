import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActiveTab } = vi.hoisted(() => ({
  mockGetActiveTab: vi.fn(),
}));

vi.mock("@aipexstudio/browser-runtime", () => ({
  getActiveTab: mockGetActiveTab,
}));

import {
  peekConversationTabBinding,
  releaseConversationTabBinding,
  resolveConversationRunContext,
} from "./conversation-tab-binding";

function tab(id: number) {
  return { id };
}

beforeEach(() => {
  mockGetActiveTab.mockReset();
});

describe("resolveConversationRunContext — per-conversation tab binding", () => {
  // Each test uses its own session id: the binding map is module-level
  // state (deliberately, so it survives across calls within one
  // conversation) and would otherwise leak a binding from one test into
  // the next.

  it("resolves against the active tab before a session id exists", async () => {
    mockGetActiveTab.mockResolvedValue(tab(12));

    const ctx = await resolveConversationRunContext(null);

    expect(ctx).toEqual({ conversationId: "pending", tabId: 12 });
  });

  it("binds a new session to whichever tab was active on its first resolution", async () => {
    mockGetActiveTab.mockResolvedValue(tab(12));

    const ctx = await resolveConversationRunContext("session-bind");

    expect(ctx).toEqual({ conversationId: "session-bind", tabId: 12 });
  });

  it("keeps reusing the bound tab even if a different tab becomes active later — the isolation guarantee", async () => {
    mockGetActiveTab.mockResolvedValue(tab(12));
    await resolveConversationRunContext("session-sticky");

    // User switches focus to a completely different tab mid-conversation.
    mockGetActiveTab.mockResolvedValue(tab(99));
    const ctx = await resolveConversationRunContext("session-sticky");

    expect(ctx).toEqual({ conversationId: "session-sticky", tabId: 12 });
  });

  it("binds two concurrent sessions to their own tabs independently", async () => {
    mockGetActiveTab.mockResolvedValue(tab(12));
    const ctxA = await resolveConversationRunContext("session-concurrent-a");

    mockGetActiveTab.mockResolvedValue(tab(27));
    const ctxB = await resolveConversationRunContext("session-concurrent-b");

    // Re-resolving A afterwards must still point at A's own tab, not B's.
    mockGetActiveTab.mockResolvedValue(tab(27));
    const ctxAAgain = await resolveConversationRunContext(
      "session-concurrent-a",
    );

    expect(ctxA).toEqual({ conversationId: "session-concurrent-a", tabId: 12 });
    expect(ctxB).toEqual({ conversationId: "session-concurrent-b", tabId: 27 });
    expect(ctxAAgain).toEqual({
      conversationId: "session-concurrent-a",
      tabId: 12,
    });
  });

  it("re-binds to the currently active tab after the binding is released", async () => {
    mockGetActiveTab.mockResolvedValue(tab(12));
    await resolveConversationRunContext("session-release");

    releaseConversationTabBinding("session-release");

    mockGetActiveTab.mockResolvedValue(tab(99));
    const ctx = await resolveConversationRunContext("session-release");

    expect(ctx).toEqual({ conversationId: "session-release", tabId: 99 });
  });

  it("resolves tabId to null when the active tab can't be determined", async () => {
    mockGetActiveTab.mockRejectedValue(new Error("No active tab found"));

    const ctx = await resolveConversationRunContext("session-no-active-tab");

    expect(ctx).toEqual({
      conversationId: "session-no-active-tab",
      tabId: null,
    });
  });
});

describe("peekConversationTabBinding — read-only lookup for UI display", () => {
  it("returns null for a session with no binding yet", () => {
    expect(peekConversationTabBinding("session-peek-none")).toBeNull();
  });

  it("returns null for a null sessionId", () => {
    expect(peekConversationTabBinding(null)).toBeNull();
  });

  it("returns the bound tab id without mutating or re-resolving anything", async () => {
    mockGetActiveTab.mockResolvedValue(tab(12));
    await resolveConversationRunContext("session-peek-bound");

    expect(peekConversationTabBinding("session-peek-bound")).toBe(12);

    // Peeking must not itself create or change a binding.
    mockGetActiveTab.mockResolvedValue(tab(99));
    expect(peekConversationTabBinding("session-peek-bound")).toBe(12);
  });

  it("returns null again after the binding is released", async () => {
    mockGetActiveTab.mockResolvedValue(tab(12));
    await resolveConversationRunContext("session-peek-release");

    releaseConversationTabBinding("session-peek-release");

    expect(peekConversationTabBinding("session-peek-release")).toBeNull();
  });
});
