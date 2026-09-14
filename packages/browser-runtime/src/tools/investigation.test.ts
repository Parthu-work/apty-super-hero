import { describe, expect, it } from "vitest";
import { recordEvidence } from "../apty/evidence-store";
import { clearInvestigation } from "../apty/investigation-session";
import {
  clearInvestigationEvidenceTool,
  getInvestigationPlanTool,
  getInvestigationStatusTool,
  getInvestigationTimelineTool,
  recordVerificationAttemptTool,
  startInvestigationTool,
  stopInvestigationTool,
  updateInvestigationTool,
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

describe("investigation lifecycle tools", () => {
  it("reports no active investigation before start_investigation is called", async () => {
    const result = (await getInvestigationStatusTool.invoke(
      runContextFor("conv-lifecycle-empty"),
      "{}",
    )) as any;

    expect(result.active).toBe(false);
    expect(result.message).toMatch(/start_investigation/);
  });

  it("start_investigation requires a resolvable conversation context", async () => {
    const result = (await startInvestigationTool.invoke(
      { context: undefined } as any,
      JSON.stringify({ userProblem: "Widget missing" }),
    )) as any;

    expect(result.started).toBe(false);
  });

  it("drives an investigation through its full lifecycle", async () => {
    const ctx = runContextFor("conv-lifecycle-full");

    const started = (await startInvestigationTool.invoke(
      ctx,
      JSON.stringify({
        userProblem: "Widget not showing on Accounts page",
        suspectedComponents: ["apty-client-widget-player"],
      }),
    )) as any;
    expect(started.started).toBe(true);
    expect(started.investigation.status).toBe("starting");
    expect(started.investigation.plan.category).toBe("generic");
    expect(started.investigation.plan.steps.length).toBeGreaterThan(0);

    const updated = (await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({
        status: "analyzing",
        addHypothesis: "Widget init request returned HTTP 500",
        diagnosis: "Widget init request returned HTTP 500",
        confidence: "likely",
      }),
    )) as any;
    expect(updated.updated).toBe(true);
    expect(updated.investigation.status).toBe("analyzing");
    expect(updated.investigation.diagnosis).toBe(
      "Widget init request returned HTTP 500",
    );
    expect(updated.investigation.confidence).toBe("likely");

    const verified = (await recordVerificationAttemptTool.invoke(
      ctx,
      JSON.stringify({ outcome: "confirmed", notes: "Re-ran the request" }),
    )) as any;
    expect(verified.recorded).toBe(true);
    expect(verified.investigation.verificationAttempts).toHaveLength(1);

    const status = (await getInvestigationStatusTool.invoke(ctx, "{}")) as any;
    expect(status.active).toBe(true);
    expect(status.investigation.confidence).toBe("likely");

    const stopped = (await stopInvestigationTool.invoke(
      ctx,
      JSON.stringify({ status: "resolved" }),
    )) as any;
    expect(stopped.stopped).toBe(true);
    expect(stopped.investigation.status).toBe("resolved");

    clearInvestigation("conv-lifecycle-full");
  });

  it("update/verify/stop are no-ops when no investigation has been started", async () => {
    const ctx = runContextFor("conv-lifecycle-noop");

    const updated = (await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({ status: "analyzing" }),
    )) as any;
    expect(updated.updated).toBe(false);

    const verified = (await recordVerificationAttemptTool.invoke(
      ctx,
      JSON.stringify({ outcome: "confirmed" }),
    )) as any;
    expect(verified.recorded).toBe(false);

    const stopped = (await stopInvestigationTool.invoke(ctx, "{}")) as any;
    expect(stopped.stopped).toBe(false);
  });

  it("isolates investigation lifecycle state between conversations", async () => {
    await startInvestigationTool.invoke(
      runContextFor("conv-lifecycle-a"),
      JSON.stringify({ userProblem: "A's problem" }),
    );
    await startInvestigationTool.invoke(
      runContextFor("conv-lifecycle-b"),
      JSON.stringify({ userProblem: "B's problem" }),
    );

    const statusA = (await getInvestigationStatusTool.invoke(
      runContextFor("conv-lifecycle-a"),
      "{}",
    )) as any;
    const statusB = (await getInvestigationStatusTool.invoke(
      runContextFor("conv-lifecycle-b"),
      "{}",
    )) as any;

    expect(statusA.investigation.userProblem).toBe("A's problem");
    expect(statusB.investigation.userProblem).toBe("B's problem");

    clearInvestigation("conv-lifecycle-a");
    clearInvestigation("conv-lifecycle-b");
  });
});

describe("getInvestigationPlanTool", () => {
  it("reports unavailable before an investigation has started", async () => {
    const result = (await getInvestigationPlanTool.invoke(
      runContextFor("conv-plan-empty"),
      "{}",
    )) as any;

    expect(result.available).toBe(false);
  });

  it("returns the plan generated by start_investigation, matched to the problem pattern", async () => {
    const ctx = runContextFor("conv-plan-tooltip");
    await startInvestigationTool.invoke(
      ctx,
      JSON.stringify({ userProblem: "The tooltip isn't showing" }),
    );

    const result = (await getInvestigationPlanTool.invoke(ctx, "{}")) as any;

    expect(result.available).toBe(true);
    expect(result.category).toBe("tooltip-not-showing");
    expect(result.pendingCount).toBe(result.plan.steps.length);

    clearInvestigation("conv-plan-tooltip");
  });

  it("marking a plan step done/skipped via update_investigation reduces the pending count", async () => {
    const ctx = runContextFor("conv-plan-progress");
    await startInvestigationTool.invoke(
      ctx,
      JSON.stringify({ userProblem: "The tooltip isn't showing" }),
    );
    const initialPlan = (await getInvestigationPlanTool.invoke(
      ctx,
      "{}",
    )) as any;
    const firstStepId = initialPlan.plan.steps[0].id;

    await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({ completedPlanStepId: firstStepId }),
    );

    const afterResult = (await getInvestigationPlanTool.invoke(
      ctx,
      "{}",
    )) as any;
    expect(afterResult.pendingCount).toBe(initialPlan.pendingCount - 1);
    expect(
      afterResult.plan.steps.find((s: any) => s.id === firstStepId).status,
    ).toBe("done");

    clearInvestigation("conv-plan-progress");
  });
});

describe("structured hypotheses via update_investigation", () => {
  it("creates and updates a hypothesis, tracking supporting evidence", async () => {
    const ctx = runContextFor("conv-hyp-tool");
    await startInvestigationTool.invoke(
      ctx,
      JSON.stringify({ userProblem: "Studio can't select this element" }),
    );

    const created = (await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({
        addHypothesis: "Element is inside a cross-origin iframe",
      }),
    )) as any;
    const hypothesisId = created.investigation.hypotheses[0].id;
    expect(created.investigation.hypotheses[0].status).toBe("open");

    const updated = (await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({
        updateHypothesis: {
          id: hypothesisId,
          status: "testing",
          addSupportingEvidenceId: "ev-abc",
        },
      }),
    )) as any;

    expect(updated.investigation.hypotheses[0].status).toBe("testing");
    expect(updated.investigation.hypotheses[0].supportingEvidenceIds).toEqual([
      "ev-abc",
    ]);

    clearInvestigation("conv-hyp-tool");
  });
});

describe("record_verification_attempt — real verification loop", () => {
  it("links an attempt to a hypothesis and updates that hypothesis's status", async () => {
    const ctx = runContextFor("conv-verify-tool");
    await startInvestigationTool.invoke(
      ctx,
      JSON.stringify({ userProblem: "Selector seems unstable" }),
    );
    const withHyp = (await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({ addHypothesis: "Selector is invalid" }),
    )) as any;
    const hypothesisId = withHyp.investigation.hypotheses[0].id;

    const result = (await recordVerificationAttemptTool.invoke(
      ctx,
      JSON.stringify({ outcome: "confirmed", hypothesisId }),
    )) as any;

    expect(result.recorded).toBe(true);
    expect(result.investigation.hypotheses[0].status).toBe("confirmed");

    clearInvestigation("conv-verify-tool");
  });

  it("downgrades an unverified 'confirmed' diagnosis to 'likely' and surfaces a warning", async () => {
    const ctx = runContextFor("conv-unverified-tool");
    await startInvestigationTool.invoke(
      ctx,
      JSON.stringify({ userProblem: "Widget error" }),
    );

    const result = (await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({
        diagnosis: "Widget init request returned HTTP 500",
        confidence: "confirmed",
      }),
    )) as any;

    expect(result.investigation.confidence).toBe("likely");
    expect(result.warning).toMatch(/downgraded/i);

    clearInvestigation("conv-unverified-tool");
  });

  it("accepts 'confirmed' once a confirmed verification attempt has been recorded, with no warning", async () => {
    const ctx = runContextFor("conv-verified-tool");
    await startInvestigationTool.invoke(
      ctx,
      JSON.stringify({ userProblem: "Widget error" }),
    );
    await recordVerificationAttemptTool.invoke(
      ctx,
      JSON.stringify({ outcome: "confirmed" }),
    );

    const result = (await updateInvestigationTool.invoke(
      ctx,
      JSON.stringify({
        diagnosis: "Widget init request returned HTTP 500",
        confidence: "confirmed",
      }),
    )) as any;

    expect(result.investigation.confidence).toBe("confirmed");
    expect(result.warning).toBeUndefined();

    clearInvestigation("conv-verified-tool");
  });
});
