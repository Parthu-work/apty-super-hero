import { describe, expect, it } from "vitest";
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
    expect(getInvestigation("conv-start")).toEqual(session);
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

  it("updates status, appends hypotheses, and dedupes suspected components", () => {
    startInvestigation({
      conversationId: "conv-update",
      tabId: 1,
      userProblem: "Studio can't select an element",
    });

    updateInvestigation("conv-update", {
      status: "collecting_evidence",
      addSuspectedComponent: "apty-studio",
    });
    const afterFirstHypothesis = updateInvestigation("conv-update", {
      addHypothesis: "Element is inside a cross-origin iframe",
      addSuspectedComponent: "apty-studio",
    });

    expect(afterFirstHypothesis?.status).toBe("collecting_evidence");
    expect(afterFirstHypothesis?.suspectedComponents).toEqual(["apty-studio"]);
    expect(afterFirstHypothesis?.hypotheses).toEqual([
      "Element is inside a cross-origin iframe",
    ]);
  });

  it("sets diagnosis and confidence via updateInvestigation", () => {
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

  it("returns undefined recording a verification attempt with no active investigation", () => {
    expect(
      recordVerificationAttempt("conv-no-investigation", {
        outcome: "confirmed",
      }),
    ).toBeUndefined();
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
