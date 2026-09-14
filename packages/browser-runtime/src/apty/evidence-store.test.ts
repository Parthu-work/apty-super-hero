import { describe, expect, it } from "vitest";
import { clearEvidence, getEvidence, recordEvidence } from "./evidence-store";

describe("evidence-store — per-conversation isolation", () => {
  // Each test uses unique conversation ids: the store is module-level state
  // (deliberately — it needs to persist across separate tool calls within
  // one conversation) and would otherwise leak between tests.

  it("generates a unique evidenceId and defaults scope from tabId", () => {
    const recorded = recordEvidence({
      conversationId: "conv-defaults",
      source: "console",
      type: "console-error",
      timestamp: 1,
      tabId: 42,
      data: {},
    });

    expect(recorded.evidenceId).toBeTruthy();
    expect(recorded.scope).toBe("tab");
  });

  it("defaults scope to unknown when no tabId is provided and scope isn't set", () => {
    const recorded = recordEvidence({
      conversationId: "conv-no-tab",
      source: "service-worker",
      type: "service-worker-error",
      timestamp: 1,
      data: {},
    });

    expect(recorded.scope).toBe("unknown");
  });

  it("respects an explicitly provided scope over the tabId-based default", () => {
    const recorded = recordEvidence({
      conversationId: "conv-explicit-scope",
      source: "service-worker",
      type: "service-worker-error",
      timestamp: 1,
      tabId: null,
      scope: "shared",
      data: {},
    });

    expect(recorded.scope).toBe("shared");
  });

  it("keeps evidence isolated between two conversations", () => {
    recordEvidence({
      conversationId: "conv-a",
      source: "console",
      type: "console-error",
      timestamp: 1,
      tabId: 1,
      data: { message: "A's error" },
    });
    recordEvidence({
      conversationId: "conv-b",
      source: "console",
      type: "console-error",
      timestamp: 1,
      tabId: 2,
      data: { message: "B's error" },
    });

    const evidenceA = getEvidence("conv-a");
    const evidenceB = getEvidence("conv-b");

    expect(evidenceA).toHaveLength(1);
    expect(evidenceB).toHaveLength(1);
    expect(evidenceA[0]?.data).toEqual({ message: "A's error" });
    expect(evidenceB[0]?.data).toEqual({ message: "B's error" });
  });

  it("returns an empty array for a conversation with no recorded evidence", () => {
    expect(getEvidence("conv-never-used")).toEqual([]);
  });

  it("treats an undefined conversationId and a literal 'pending' id as the same unscoped bucket", () => {
    recordEvidence({
      conversationId: undefined,
      source: "console",
      type: "console-error",
      timestamp: 1,
      tabId: 1,
      data: { n: 1 },
    });
    recordEvidence({
      conversationId: "pending",
      source: "console",
      type: "console-error",
      timestamp: 2,
      tabId: 1,
      data: { n: 2 },
    });

    expect(getEvidence(undefined)).toHaveLength(2);
    expect(getEvidence("pending")).toHaveLength(2);
  });

  it("clears only the targeted conversation's evidence", () => {
    recordEvidence({
      conversationId: "conv-clear-a",
      source: "console",
      type: "console-error",
      timestamp: 1,
      tabId: 1,
      data: {},
    });
    recordEvidence({
      conversationId: "conv-clear-b",
      source: "console",
      type: "console-error",
      timestamp: 1,
      tabId: 1,
      data: {},
    });

    clearEvidence("conv-clear-a");

    expect(getEvidence("conv-clear-a")).toEqual([]);
    expect(getEvidence("conv-clear-b")).toHaveLength(1);
  });

  it("drops the oldest entries once a conversation exceeds the bounded capacity", () => {
    const conversationId = "conv-overflow";
    for (let i = 0; i < 510; i++) {
      recordEvidence({
        conversationId,
        source: "console",
        type: "console-error",
        timestamp: i,
        tabId: 1,
        data: { i },
      });
    }

    const stored = getEvidence(conversationId);

    expect(stored.length).toBeLessThanOrEqual(500);
    // Oldest entries (timestamp 0..9) should have been dropped, newest kept.
    expect(stored[stored.length - 1]?.data).toEqual({ i: 509 });
    expect(stored.some((e) => (e.data as { i: number }).i === 0)).toBe(false);
  });
});
