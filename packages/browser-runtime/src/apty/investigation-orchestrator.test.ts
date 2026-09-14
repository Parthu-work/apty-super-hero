import { describe, expect, it } from "vitest";
import {
  decideNextAction,
  getBudgetStatus,
  getToolCallLog,
  ORCHESTRATOR_LIMITS,
  recordToolCall,
} from "./investigation-orchestrator";
import { planInvestigation } from "./investigation-planner";
import {
  recordVerificationAttempt,
  startInvestigation,
  updateInvestigation,
} from "./investigation-session";
import type { DiagnosticEvidence } from "./types";

function evidence(count: number): DiagnosticEvidence[] {
  return Array.from({ length: count }, (_, i) => ({
    evidenceId: `ev-${i}`,
    source: "console",
    timestamp: Date.now(),
    type: "console-error",
    scope: "tab",
    data: {},
  }));
}

describe("investigation-orchestrator — tool call ledger", () => {
  it("records and retrieves calls for a conversation", () => {
    recordToolCall("conv-ledger-a", "get_apty_widget_diagnostics", {});
    recordToolCall("conv-ledger-a", "get_network_diagnostics", {
      windowMs: 3000,
    });

    const log = getToolCallLog("conv-ledger-a");
    expect(log).toHaveLength(2);
    expect(log[0].tool).toBe("get_apty_widget_diagnostics");
  });

  it("isolates ledgers between conversations", () => {
    recordToolCall("conv-ledger-iso-a", "get_apty_widget_diagnostics", {});
    recordToolCall("conv-ledger-iso-b", "get_network_diagnostics", {});

    expect(getToolCallLog("conv-ledger-iso-a")).toHaveLength(1);
    expect(getToolCallLog("conv-ledger-iso-b")).toHaveLength(1);
  });

  it("produces the same signature regardless of argument key order", () => {
    recordToolCall("conv-ledger-sig", "analyze_element_selectors", {
      tabId: 1,
      uid: "abc",
    });
    recordToolCall("conv-ledger-sig", "analyze_element_selectors", {
      uid: "abc",
      tabId: 1,
    });

    const log = getToolCallLog("conv-ledger-sig");
    expect(log[0].argsSignature).toBe(log[1].argsSignature);
  });
});

describe("investigation-orchestrator — budget status", () => {
  it("reports no duplicates and remaining budget for a fresh investigation", () => {
    const startedAt = Date.now();
    recordToolCall("conv-budget-fresh", "get_apty_widget_diagnostics", {});
    const status = getBudgetStatus("conv-budget-fresh", startedAt);

    expect(status.toolCallsUsed).toBe(1);
    expect(status.overBudget).toBe(false);
    expect(status.loopDetected).toBe(false);
    expect(status.toolCallsRemaining).toBe(
      ORCHESTRATOR_LIMITS.maxToolCalls - 1,
    );
  });

  it("flags a loop when the same tool+args repeats past the duplicate threshold", () => {
    const startedAt = Date.now();
    for (let i = 0; i < ORCHESTRATOR_LIMITS.maxDuplicateCalls; i++) {
      recordToolCall("conv-budget-loop", "get_network_diagnostics", {
        windowMs: 3000,
      });
    }
    const status = getBudgetStatus("conv-budget-loop", startedAt);

    expect(status.loopDetected).toBe(true);
    expect(status.duplicateWarnings[0]).toMatchObject({
      tool: "get_network_diagnostics",
      count: ORCHESTRATOR_LIMITS.maxDuplicateCalls,
    });
  });

  it("does not flag a loop for varied arguments to the same tool", () => {
    const startedAt = Date.now();
    for (let i = 0; i < ORCHESTRATOR_LIMITS.maxDuplicateCalls; i++) {
      recordToolCall("conv-budget-varied", "get_network_diagnostics", {
        windowMs: 1000 + i,
      });
    }
    expect(getBudgetStatus("conv-budget-varied", startedAt).loopDetected).toBe(
      false,
    );
  });

  it("flags over-budget once maxToolCalls is reached", () => {
    const startedAt = Date.now();
    for (let i = 0; i < ORCHESTRATOR_LIMITS.maxToolCalls; i++) {
      recordToolCall("conv-budget-max", "get_apty_client_diagnostics", {
        attempt: i,
      });
    }
    const status = getBudgetStatus("conv-budget-max", startedAt);
    expect(status.overBudget).toBe(true);
    expect(status.overBudgetReason).toBe("max_tool_calls");
  });

  it("ignores tool calls recorded before the investigation started", () => {
    recordToolCall("conv-budget-stale", "get_apty_widget_diagnostics", {});
    const startedAfter = Date.now() + 1000;
    const status = getBudgetStatus("conv-budget-stale", startedAfter);
    expect(status.toolCallsUsed).toBe(0);
  });
});

describe("investigation-orchestrator — decideNextAction", () => {
  it("recommends the first pending plan step's tool when nothing has been called yet", () => {
    const plan = planInvestigation("The tooltip isn't showing");
    const session = startInvestigation({
      conversationId: "conv-decide-plan",
      tabId: 1,
      userProblem: "The tooltip isn't showing",
      plan,
    });

    const action = decideNextAction(session, []);
    expect(action.action).toBe("call_tool");
    if (action.action === "call_tool") {
      expect(action.tool).toBe(plan.steps[0].suggestedTools[0]);
      expect(action.planStepId).toBe(plan.steps[0].id);
    }
  });

  it("skips a plan step whose suggested tool was already called", () => {
    const plan = planInvestigation("The tooltip isn't showing");
    const session = startInvestigation({
      conversationId: "conv-decide-skip",
      tabId: 1,
      userProblem: "The tooltip isn't showing",
      plan,
    });
    recordToolCall("conv-decide-skip", "get_page_metadata", {});

    const action = decideNextAction(session, []);
    expect(action.action).toBe("call_tool");
    if (action.action === "call_tool") {
      expect(action.tool).not.toBe("get_page_metadata");
    }
  });

  it("recommends verifying a supported hypothesis before anything else", () => {
    const _session0 = startInvestigation({
      conversationId: "conv-decide-verify",
      tabId: 1,
      userProblem: "generic problem",
    });
    updateInvestigation("conv-decide-verify", {
      addHypothesis: "Selector changed in production",
    });
    const withHyp = updateInvestigation("conv-decide-verify", {});
    const hypothesisId = withHyp!.hypotheses[0].id;
    const session = updateInvestigation("conv-decide-verify", {
      updateHypothesis: { id: hypothesisId, status: "supported" },
    })!;

    const action = decideNextAction(session, evidence(1));
    expect(action).toMatchObject({ action: "verify", hypothesisId });
  });

  it("stops with 'confirmed' once the diagnosis is confirmed", () => {
    const _session0 = startInvestigation({
      conversationId: "conv-decide-confirmed",
      tabId: 1,
      userProblem: "generic problem",
    });
    recordVerificationAttempt("conv-decide-confirmed", {
      outcome: "confirmed",
    });
    const session = updateInvestigation("conv-decide-confirmed", {
      diagnosis: "Selector mismatch",
      confidence: "confirmed",
    })!;

    const action = decideNextAction(session, evidence(1));
    expect(action).toMatchObject({ action: "stop", reason: "confirmed" });
  });

  it("stops with 'loop_detected' when guardrails are tripped, even mid-plan", () => {
    const plan = planInvestigation("generic problem needing investigation");
    const session = startInvestigation({
      conversationId: "conv-decide-loop",
      tabId: 1,
      userProblem: "generic problem needing investigation",
      plan,
    });
    for (let i = 0; i < ORCHESTRATOR_LIMITS.maxDuplicateCalls; i++) {
      recordToolCall("conv-decide-loop", "get_page_metadata", {});
    }

    const action = decideNextAction(session, []);
    expect(action).toMatchObject({ action: "stop", reason: "loop_detected" });
  });

  it("stops with 'blocked' when no evidence and no pending plan steps remain", () => {
    const session = startInvestigation({
      conversationId: "conv-decide-blocked",
      tabId: 1,
      userProblem: "generic problem",
      plan: { category: "generic", steps: [] },
    });

    const action = decideNextAction(session, []);
    expect(action).toMatchObject({ action: "stop", reason: "blocked" });
  });

  it("recommends analyzing when evidence exists but no hypothesis has been formed", () => {
    const session = startInvestigation({
      conversationId: "conv-decide-analyze",
      tabId: 1,
      userProblem: "generic problem",
      plan: { category: "generic", steps: [] },
    });

    const action = decideNextAction(session, evidence(2));
    expect(action.action).toBe("analyze");
  });
});
