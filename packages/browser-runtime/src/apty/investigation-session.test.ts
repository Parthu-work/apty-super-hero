import { describe, expect, it } from "vitest";
import { planInvestigation } from "./investigation-planner";
import {
  clearInvestigation,
  getInvestigation,
  recordVerificationAttempt,
  startInvestigation,
  stopInvestigation,
  updateInvestigation,
} from "./investigation-session";

describe("investigation-session — lifecycle", () => {
  it("starts a new investigation in the 'starting' status", () => {
    const session = startInvestigation({
      conversationId: "conv-start",
      tabId: 7,
      userProblem: "Widget not showing on Accounts page",
    });

    expect(session.status).toBe("starting");
    expect(session.tabId).toBe(7);
    expect(session.userProblem).toBe("Widget not showing on Accounts page");
    expect(session.suspectedComponents).toEqual([]);
    expect(session.hypotheses).toEqual([]);
    expect(session.verificationAttempts).toEqual([]);
    expect(session.diagnosis).toBeUndefined();
    expect(session.plan).toBeUndefined();
    expect(getInvestigation("conv-start")).toEqual(session);
  });

  it("stores a plan when one is provided at start", () => {
    const plan = planInvestigation("The tooltip isn't showing");
    const session = startInvestigation({
      conversationId: "conv-plan",
      tabId: 1,
      userProblem: "The tooltip isn't showing",
      plan,
    });

    expect(session.plan?.category).toBe("tooltip-not-showing");
    expect(session.plan?.steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("returns undefined for a conversation with no investigation", () => {
    expect(getInvestigation("conv-none")).toBeUndefined();
  });

  it("isolates investigations between conversations", () => {
    startInvestigation({
      conversationId: "conv-iso-a",
      tabId: 1,
      userProblem: "A's problem",
    });
    startInvestigation({
      conversationId: "conv-iso-b",
      tabId: 2,
      userProblem: "B's problem",
    });

    expect(getInvestigation("conv-iso-a")?.userProblem).toBe("A's problem");
    expect(getInvestigation("conv-iso-b")?.userProblem).toBe("B's problem");
  });

  it("updates status and dedupes suspected components using the unified Apty component model", () => {
    startInvestigation({
      conversationId: "conv-update",
      tabId: 1,
      userProblem: "Studio can't select an element",
    });

    updateInvestigation("conv-update", {
      status: "collecting_evidence",
      addSuspectedComponent: "apty-studio",
    });
    const afterSecondAdd = updateInvestigation("conv-update", {
      addSuspectedComponent: "apty-studio",
    });

    expect(afterSecondAdd?.status).toBe("collecting_evidence");
    expect(afterSecondAdd?.suspectedComponents).toEqual(["apty-studio"]);
  });

  it("supports the unified apty-client-widget-player component (not split into client/widget/service-worker)", () => {
    startInvestigation({
      conversationId: "conv-runtime-component",
      tabId: 1,
      userProblem: "Widget not loading",
    });

    const updated = updateInvestigation("conv-runtime-component", {
      addSuspectedComponent: "apty-client-widget-player",
    });

    expect(updated?.suspectedComponents).toEqual(["apty-client-widget-player"]);
  });

  it("adds a structured hypothesis with 'open' status and 'unknown' confidence by default", () => {
    startInvestigation({
      conversationId: "conv-hypothesis",
      tabId: 1,
      userProblem: "Widget error",
    });

    const updated = updateInvestigation("conv-hypothesis", {
      addHypothesis: "Widget init request returned HTTP 500",
    });

    expect(updated?.hypotheses).toHaveLength(1);
    const hypothesis = updated!.hypotheses[0]!;
    expect(hypothesis.statement).toBe("Widget init request returned HTTP 500");
    expect(hypothesis.status).toBe("open");
    expect(hypothesis.confidence).toBe("unknown");
    expect(hypothesis.supportingEvidenceIds).toEqual([]);
    expect(hypothesis.contradictingEvidenceIds).toEqual([]);
  });

  it("updates a specific hypothesis by id, tracking supporting/contradicting evidence", () => {
    startInvestigation({
      conversationId: "conv-hypothesis-update",
      tabId: 1,
      userProblem: "Widget error",
    });
    const withHypothesis = updateInvestigation("conv-hypothesis-update", {
      addHypothesis: "Widget init request returned HTTP 500",
    });
    const hypothesisId = withHypothesis!.hypotheses[0]!.id;

    const updated = updateInvestigation("conv-hypothesis-update", {
      updateHypothesis: {
        id: hypothesisId,
        status: "testing",
        addSupportingEvidenceId: "ev-1",
      },
    });
    const updatedAgain = updateInvestigation("conv-hypothesis-update", {
      updateHypothesis: {
        id: hypothesisId,
        addSupportingEvidenceId: "ev-1", // duplicate, should not double-add
        addContradictingEvidenceId: "ev-2",
      },
    });

    expect(updated?.hypotheses[0]?.status).toBe("testing");
    expect(updatedAgain?.hypotheses[0]?.supportingEvidenceIds).toEqual([
      "ev-1",
    ]);
    expect(updatedAgain?.hypotheses[0]?.contradictingEvidenceIds).toEqual([
      "ev-2",
    ]);
  });

  it("leaves other hypotheses untouched when updating one by id", () => {
    startInvestigation({
      conversationId: "conv-hypothesis-multi",
      tabId: 1,
      userProblem: "Widget error",
    });
    updateInvestigation("conv-hypothesis-multi", { addHypothesis: "First" });
    const afterSecond = updateInvestigation("conv-hypothesis-multi", {
      addHypothesis: "Second",
    });
    const firstId = afterSecond!.hypotheses[0]!.id;

    const updated = updateInvestigation("conv-hypothesis-multi", {
      updateHypothesis: { id: firstId, status: "rejected" },
    });

    expect(updated?.hypotheses[0]?.status).toBe("rejected");
    expect(updated?.hypotheses[1]?.status).toBe("open");
  });

  it("sets diagnosis directly for non-confirmed confidence levels", () => {
    startInvestigation({
      conversationId: "conv-diagnosis",
      tabId: 1,
      userProblem: "Widget error",
    });

    const updated = updateInvestigation("conv-diagnosis", {
      status: "analyzing",
      diagnosis: "Widget init request returned HTTP 500",
      confidence: "likely",
    });

    expect(updated?.diagnosis).toBe("Widget init request returned HTTP 500");
    expect(updated?.confidence).toBe("likely");
  });

  it("downgrades an unverified 'confirmed' confidence to 'likely'", () => {
    startInvestigation({
      conversationId: "conv-unverified-confirm",
      tabId: 1,
      userProblem: "Widget error",
    });

    const updated = updateInvestigation("conv-unverified-confirm", {
      diagnosis: "Widget init request returned HTTP 500",
      confidence: "confirmed",
    });

    expect(updated?.confidence).toBe("likely");
  });

  it("allows 'confirmed' confidence once a confirmed verification attempt exists", () => {
    startInvestigation({
      conversationId: "conv-verified-confirm",
      tabId: 1,
      userProblem: "Widget error",
    });
    recordVerificationAttempt("conv-verified-confirm", {
      outcome: "confirmed",
    });

    const updated = updateInvestigation("conv-verified-confirm", {
      diagnosis: "Widget init request returned HTTP 500",
      confidence: "confirmed",
    });

    expect(updated?.confidence).toBe("confirmed");
  });

  it("returns undefined when updating a conversation with no investigation", () => {
    expect(
      updateInvestigation("conv-missing", { status: "analyzing" }),
    ).toBeUndefined();
  });

  it("records verification attempts in order", () => {
    startInvestigation({
      conversationId: "conv-verify",
      tabId: 1,
      userProblem: "Widget error",
    });

    recordVerificationAttempt("conv-verify", {
      outcome: "inconclusive",
      notes: "Network check still pending",
    });
    const updated = recordVerificationAttempt("conv-verify", {
      outcome: "confirmed",
    });

    expect(updated?.verificationAttempts).toHaveLength(2);
    expect(updated?.verificationAttempts[0]?.outcome).toBe("inconclusive");
    expect(updated?.verificationAttempts[1]?.outcome).toBe("confirmed");
  });

  it("links a verification attempt to a hypothesis and updates its status", () => {
    startInvestigation({
      conversationId: "conv-verify-hypothesis",
      tabId: 1,
      userProblem: "Widget error",
    });
    const withHypothesis = updateInvestigation("conv-verify-hypothesis", {
      addHypothesis: "Selector is invalid",
    });
    const hypothesisId = withHypothesis!.hypotheses[0]!.id;

    const confirmed = recordVerificationAttempt("conv-verify-hypothesis", {
      outcome: "confirmed",
      hypothesisId,
    });
    expect(confirmed?.hypotheses[0]?.status).toBe("confirmed");

    const rejected = recordVerificationAttempt("conv-verify-hypothesis", {
      outcome: "not_confirmed",
      hypothesisId,
    });
    expect(rejected?.hypotheses[0]?.status).toBe("rejected");
  });

  it("returns undefined recording a verification attempt with no active investigation", () => {
    expect(
      recordVerificationAttempt("conv-no-investigation", {
        outcome: "confirmed",
      }),
    ).toBeUndefined();
  });

  it("marks a plan step done or skipped", () => {
    const plan = planInvestigation("tooltip not showing");
    startInvestigation({
      conversationId: "conv-plan-steps",
      tabId: 1,
      userProblem: "tooltip not showing",
      plan,
    });
    const firstStepId = plan.steps[0]!.id;
    const secondStepId = plan.steps[1]!.id;

    const afterDone = updateInvestigation("conv-plan-steps", {
      completedPlanStepId: firstStepId,
    });
    const afterSkipped = updateInvestigation("conv-plan-steps", {
      skippedPlanStepId: secondStepId,
    });

    expect(
      afterDone?.plan?.steps.find((s) => s.id === firstStepId)?.status,
    ).toBe("done");
    expect(
      afterSkipped?.plan?.steps.find((s) => s.id === secondStepId)?.status,
    ).toBe("skipped");
  });

  it("stops an investigation into a terminal status, defaulting to 'stopped'", () => {
    startInvestigation({
      conversationId: "conv-stop",
      tabId: 1,
      userProblem: "Widget error",
    });

    const stopped = stopInvestigation("conv-stop");
    expect(stopped?.status).toBe("stopped");
  });

  it("stops an investigation as resolved when given an explicit status", () => {
    startInvestigation({
      conversationId: "conv-resolve",
      tabId: 1,
      userProblem: "Widget error",
    });

    const resolved = stopInvestigation("conv-resolve", "resolved");
    expect(resolved?.status).toBe("resolved");
  });

  it("clears an investigation so it no longer appears", () => {
    startInvestigation({
      conversationId: "conv-clear",
      tabId: 1,
      userProblem: "Widget error",
    });
    expect(getInvestigation("conv-clear")).toBeDefined();

    clearInvestigation("conv-clear");
    expect(getInvestigation("conv-clear")).toBeUndefined();
  });

  it("starting a new investigation replaces a prior one for the same conversation", () => {
    startInvestigation({
      conversationId: "conv-restart",
      tabId: 1,
      userProblem: "First problem",
    });
    updateInvestigation("conv-restart", { status: "resolved" });

    const restarted = startInvestigation({
      conversationId: "conv-restart",
      tabId: 1,
      userProblem: "Second, unrelated problem",
    });

    expect(restarted.status).toBe("starting");
    expect(restarted.userProblem).toBe("Second, unrelated problem");
    expect(getInvestigation("conv-restart")?.userProblem).toBe(
      "Second, unrelated problem",
    );
  });

  it("treats 'pending' and undefined conversationId as the same unscoped bucket, matching evidence-store", () => {
    startInvestigation({
      conversationId: "pending",
      tabId: null,
      userProblem: "Pre-session problem",
    });

    expect(getInvestigation(undefined)?.userProblem).toBe(
      "Pre-session problem",
    );
  });
});
