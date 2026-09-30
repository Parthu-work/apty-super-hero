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

  it("de-duplicates an identical (source, type, tabId, frameId, requestId) record instead of storing it twice", () => {
    const conversationId = "conv-dedupe-network";
    const record = {
      conversationId,
      source: "network" as const,
      type: "network-http-error",
      timestamp: 1,
      tabId: 1,
      requestId: "req-1",
      data: { status: 500 },
    };

    recordEvidence(record);
    // Same request seen again (e.g. two overlapping capture windows both
    // observing it) — must not be stored a second time.
    recordEvidence({ ...record, timestamp: 2 });

    expect(getEvidence(conversationId)).toHaveLength(1);
  });

  it("does not de-duplicate genuinely different evidence that only shares a timestamp", () => {
    const conversationId = "conv-dedupe-distinct";
    recordEvidence({
      conversationId,
      source: "network",
      type: "network-http-error",
      timestamp: 1,
      tabId: 1,
      requestId: "req-a",
      data: { status: 500 },
    });
    recordEvidence({
      conversationId,
      source: "network",
      type: "network-http-error",
      timestamp: 1,
      tabId: 1,
      requestId: "req-b",
      data: { status: 404 },
    });

    expect(getEvidence(conversationId)).toHaveLength(2);
  });

  it("falls back to timestamp for de-duplication when there is no requestId (non-network evidence)", () => {
    const conversationId = "conv-dedupe-no-request-id";
    const record = {
      conversationId,
      source: "console" as const,
      type: "console-error",
      timestamp: 5,
      tabId: 1,
      data: { message: "same error" },
    };

    recordEvidence(record);
    recordEvidence(record);

    expect(getEvidence(conversationId)).toHaveLength(1);
  });

  it("caps a single noisy source at its own per-source quota without evicting a different, rarer source's evidence", () => {
    const conversationId = "conv-per-source-quota";

    // One single, rare piece of widget-status evidence.
    recordEvidence({
      conversationId,
      source: "apty-widget",
      type: "widget-status",
      timestamp: 0,
      tabId: 1,
      data: { rare: true },
    });

    // A noisy network source recording well past the per-source quota
    // (150), each with a distinct requestId so none of them de-duplicate.
    for (let i = 0; i < 200; i++) {
      recordEvidence({
        conversationId,
        source: "network",
        type: "network-http-error",
        timestamp: i + 1,
        tabId: 1,
        requestId: `req-${i}`,
        data: { i },
      });
    }

    const stored = getEvidence(conversationId);
    const widgetEvidence = stored.filter((e) => e.source === "apty-widget");
    const networkEvidence = stored.filter((e) => e.source === "network");

    // The rare widget-status record survived the network flood...
    expect(widgetEvidence).toHaveLength(1);
    // ...while the noisy network source was capped at its own quota, not
    // the other way around.
    expect(networkEvidence.length).toBeLessThan(200);
    expect(networkEvidence.length).toBeGreaterThan(0);
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
