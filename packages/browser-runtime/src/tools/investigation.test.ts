import { describe, expect, it } from "vitest";
import { recordEvidence } from "../apty/evidence-store";
import {
  clearInvestigationEvidenceTool,
  getInvestigationTimelineTool,
} from "./investigation";

function runContextFor(conversationId: string) {
  return { context: { conversationId, tabId: 1 } } as any;
}

describe("getInvestigationTimelineTool", () => {
  it("reports unavailable when no evidence has been collected for this conversation", async () => {
    const result = (await getInvestigationTimelineTool.invoke(
      runContextFor("conv-empty"),
      JSON.stringify({ windowMs: 2000 }),
    )) as any;

    expect(result.available).toBe(false);
    expect(result.message).toMatch(/no diagnostic evidence/i);
  });

  it("returns a correlated timeline scoped to only this conversation's evidence", async () => {
    recordEvidence({
      conversationId: "conv-timeline-a",
      source: "network",
      type: "network-http-error",
      timestamp: 0,
      tabId: 1,
      data: {},
    });
    recordEvidence({
      conversationId: "conv-timeline-a",
      source: "console",
      type: "console-error",
      timestamp: 300,
      tabId: 1,
      data: {},
    });
    // A different conversation's evidence must never leak into conv-timeline-a's timeline.
    recordEvidence({
      conversationId: "conv-timeline-b",
      source: "console",
      type: "console-error",
      timestamp: 100,
      tabId: 2,
      data: {},
    });

    const result = (await getInvestigationTimelineTool.invoke(
      runContextFor("conv-timeline-a"),
      JSON.stringify({ windowMs: 2000 }),
    )) as any;

    expect(result.available).toBe(true);
    expect(result.evidenceCount).toBe(2);
    expect(result.likelyIncidentClusterCount).toBe(1);
    expect(result.timeline).toContain("network-http-error");
    expect(result.timeline).toContain("console-error");
  });
});

describe("clearInvestigationEvidenceTool", () => {
  it("clears evidence only for the requesting conversation", async () => {
    recordEvidence({
      conversationId: "conv-clear-x",
      source: "console",
      type: "console-error",
      timestamp: 0,
      tabId: 1,
      data: {},
    });
    recordEvidence({
      conversationId: "conv-clear-y",
      source: "console",
      type: "console-error",
      timestamp: 0,
      tabId: 1,
      data: {},
    });

    const result = (await clearInvestigationEvidenceTool.invoke(
      runContextFor("conv-clear-x"),
      "{}",
    )) as any;

    expect(result.cleared).toBe(true);
    expect(result.clearedCount).toBe(1);

    const timelineAfterClear = (await getInvestigationTimelineTool.invoke(
      runContextFor("conv-clear-x"),
      JSON.stringify({ windowMs: 2000 }),
    )) as any;
    expect(timelineAfterClear.available).toBe(false);

    const otherConversationTimeline =
      (await getInvestigationTimelineTool.invoke(
        runContextFor("conv-clear-y"),
        JSON.stringify({ windowMs: 2000 }),
      )) as any;
    expect(otherConversationTimeline.available).toBe(true);
  });
});
