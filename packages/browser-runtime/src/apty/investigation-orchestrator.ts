/**
 * Autonomous investigation orchestrator.
 *
 * Tool execution in this codebase is driven by an LLM one call at a time
 * (see `tools/index.ts`) — there is no separate process that calls tools on
 * its own. This module does not change that; it is the deterministic layer
 * the model consults on every turn (via `get_next_investigation_action`) to
 * decide what to do next, plus the bounded-execution guardrail that keeps
 * that loop honest: a step/time budget, and duplicate-call (loop) detection
 * enforced server-side rather than left to prompt discipline alone.
 *
 * Before this module, `investigation-planner.ts` produced a static ordered
 * checklist the model was free to ignore entirely, with nothing tracking
 * which diagnostic tools had actually been called or how much investigation
 * budget remained. This closes that gap: `recordToolCall` is called by each
 * diagnostic tool as a side effect (mirroring how `recordEvidence` already
 * works), and `decideNextAction` combines that call history with the
 * investigation's plan/hypotheses/evidence to produce one deterministic
 * recommendation — call a specific tool, verify a hypothesis, analyze
 * collected evidence, or stop (budget exceeded, loop detected, blocked, or
 * evidence exhausted).
 */
import type { InvestigationSession } from "./investigation-session.js";
import type { DiagnosticEvidence } from "./types.js";

/** Bounds enforced on every investigation, per the P0 orchestrator-safety requirement: no infinite loops, no unbounded tool calling. */
export const ORCHESTRATOR_LIMITS = {
  /** Diagnostic tool calls tracked per investigation before a hard stop. */
  maxToolCalls: 25,
  /** How many times the exact same tool+args may repeat before it's flagged as a loop. */
  maxDuplicateCalls: 3,
  /** Wall-clock budget for a single investigation. */
  maxDurationMs: 15 * 60 * 1000,
} as const;

/** Hard cap on the call-history ledger itself, independent of any one investigation's budget — the ledger must stay bounded even across many investigations in the same conversation. */
const MAX_TRACKED_CALLS = 200;

export interface ToolCallRecord {
  tool: string;
  argsSignature: string;
  timestamp: number;
}

const UNSCOPED_KEY = "__unscoped__";
function keyFor(conversationId: string | undefined): string {
  return conversationId && conversationId !== "pending"
    ? conversationId
    : UNSCOPED_KEY;
}

/** Deterministic, order-independent signature for a tool call's arguments, so `{a:1,b:2}` and `{b:2,a:1}` are recognized as the same call for loop detection. */
function stableSignature(value: unknown): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, sorted(val)]),
      );
    }
    return v;
  };
  try {
    return JSON.stringify(sorted(value ?? {}));
  } catch {
    return String(value);
  }
}

const callLogByConversation = new Map<string, ToolCallRecord[]>();

/** Record that a diagnostic tool was called, for budget/loop-detection purposes. Called as a side effect from diagnostic tools (apty.ts, devtools.ts, selector.ts), mirroring `recordEvidence`. */
export function recordToolCall(
  conversationId: string | undefined,
  tool: string,
  args?: unknown,
): void {
  const key = keyFor(conversationId);
  const list = callLogByConversation.get(key) ?? [];
  list.push({
    tool,
    argsSignature: stableSignature(args),
    timestamp: Date.now(),
  });
  if (list.length > MAX_TRACKED_CALLS) {
    list.splice(0, list.length - MAX_TRACKED_CALLS);
  }
  callLogByConversation.set(key, list);
}

/** The tool-call ledger for a conversation, oldest first. */
export function getToolCallLog(
  conversationId: string | undefined,
): ToolCallRecord[] {
  return [...(callLogByConversation.get(keyFor(conversationId)) ?? [])];
}

/** Discard the tool-call ledger for a conversation (call alongside `clearInvestigation`/`clearEvidence`). */
export function clearToolCallLog(conversationId: string | undefined): void {
  callLogByConversation.delete(keyFor(conversationId));
}

/** Test/debug helper. */
export function getTrackedCallLogCount(): number {
  return callLogByConversation.size;
}

export interface DuplicateCallWarning {
  tool: string;
  argsSignature: string;
  count: number;
}

export interface OrchestratorBudgetStatus {
  toolCallsUsed: number;
  toolCallsRemaining: number;
  elapsedMs: number;
  overBudget: boolean;
  overBudgetReason?: "max_tool_calls" | "max_duration";
  duplicateWarnings: DuplicateCallWarning[];
  loopDetected: boolean;
}

/**
 * Compute budget/loop status for the current investigation, considering
 * only tool calls recorded since `investigationStartedAt` — calls made
 * before the current investigation started (e.g. during a prior one in the
 * same conversation) never count against a fresh investigation's budget.
 */
export function getBudgetStatus(
  conversationId: string | undefined,
  investigationStartedAt: number,
): OrchestratorBudgetStatus {
  const log = getToolCallLog(conversationId).filter(
    (c) => c.timestamp >= investigationStartedAt,
  );
  const elapsedMs = Date.now() - investigationStartedAt;

  const counts = new Map<string, number>();
  for (const c of log) {
    const key = `${c.tool}::${c.argsSignature}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const duplicateWarnings: DuplicateCallWarning[] = [...counts.entries()]
    .filter(([, count]) => count >= ORCHESTRATOR_LIMITS.maxDuplicateCalls)
    .map(([key, count]) => {
      const separatorIndex = key.indexOf("::");
      return {
        tool: key.slice(0, separatorIndex),
        argsSignature: key.slice(separatorIndex + 2),
        count,
      };
    });

  const overMaxCalls = log.length >= ORCHESTRATOR_LIMITS.maxToolCalls;
  const overMaxDuration = elapsedMs >= ORCHESTRATOR_LIMITS.maxDurationMs;

  return {
    toolCallsUsed: log.length,
    toolCallsRemaining: Math.max(
      0,
      ORCHESTRATOR_LIMITS.maxToolCalls - log.length,
    ),
    elapsedMs,
    overBudget: overMaxCalls || overMaxDuration,
    overBudgetReason: overMaxCalls
      ? "max_tool_calls"
      : overMaxDuration
        ? "max_duration"
        : undefined,
    duplicateWarnings,
    loopDetected: duplicateWarnings.length > 0,
  };
}

export type OrchestratorAction =
  | { action: "call_tool"; tool: string; planStepId?: string; reason: string }
  | { action: "verify"; hypothesisId: string; reason: string }
  | { action: "analyze"; reason: string }
  | {
      action: "stop";
      reason:
        | "confirmed"
        | "loop_detected"
        | "budget_exceeded"
        | "blocked"
        | "evidence_exhausted";
      detail: string;
    };

/**
 * Decide the single next action the model should take for an investigation,
 * deterministically. Guardrails (loop detection, budget) always take
 * precedence over plan/hypothesis progression — an investigation that has
 * confirmed its root cause or exhausted its budget must stop regardless of
 * how much of the plan remains.
 */
export function decideNextAction(
  session: InvestigationSession,
  evidence: DiagnosticEvidence[],
): OrchestratorAction {
  const budget = getBudgetStatus(session.conversationId, session.startedAt);

  const warning = budget.duplicateWarnings[0];
  if (warning) {
    return {
      action: "stop",
      reason: "loop_detected",
      detail: `'${warning.tool}' has been called ${warning.count} times with the same arguments without resolving the investigation. Stop repeating it — try a different diagnostic tool, or conclude with the evidence already collected at an honest confidence level.`,
    };
  }
  if (budget.overBudget) {
    return {
      action: "stop",
      reason: "budget_exceeded",
      detail:
        budget.overBudgetReason === "max_tool_calls"
          ? `Reached the ${ORCHESTRATOR_LIMITS.maxToolCalls}-tool-call investigation budget. Summarize the evidence gathered so far and report the best-supported conclusion at an honest confidence level rather than collecting more evidence.`
          : `Reached the ${Math.round(ORCHESTRATOR_LIMITS.maxDurationMs / 60000)}-minute investigation time budget. Summarize and conclude.`,
    };
  }

  if (session.confidence === "confirmed" && session.diagnosis) {
    return {
      action: "stop",
      reason: "confirmed",
      detail:
        "Root cause already confirmed by a verified hypothesis. Report the diagnosis and recommended fix — no further evidence collection is needed.",
    };
  }

  const toVerify = session.hypotheses.find((h) => h.status === "supported");
  if (toVerify) {
    return {
      action: "verify",
      hypothesisId: toVerify.id,
      reason: `Hypothesis "${toVerify.statement}" has supporting evidence but has not been verified yet. Perform a deterministic re-check (re-test the selector, re-check the status, re-run the failed request) and call record_verification_attempt with hypothesisId "${toVerify.id}".`,
    };
  }

  const plan = session.plan;
  if (plan) {
    const calledTools = new Set(
      getToolCallLog(session.conversationId)
        .filter((c) => c.timestamp >= session.startedAt)
        .map((c) => c.tool),
    );
    const nextStep = plan.steps.find(
      (s) =>
        s.status === "pending" &&
        !s.suggestedTools.every((t) => calledTools.has(t)),
    );
    // `nextStep` is only matched when at least one of its suggestedTools
    // hasn't been called yet, so `tool` is always found here — the
    // "get_investigation_timeline" fallback only guards a plan template
    // that was defined with an empty suggestedTools list.
    if (nextStep) {
      const tool =
        nextStep.suggestedTools.find((t) => !calledTools.has(t)) ??
        "get_investigation_timeline";
      return {
        action: "call_tool",
        tool,
        planStepId: nextStep.id,
        reason: `Plan step "${nextStep.description}" is still pending.`,
      };
    }
  }

  const openHypothesis = session.hypotheses.find(
    (h) => h.status === "open" || h.status === "testing",
  );
  if (openHypothesis) {
    return {
      action: "analyze",
      reason: `Hypothesis "${openHypothesis.statement}" is still ${openHypothesis.status} — cite supporting or contradicting evidence via update_investigation, then move it to 'supported' once the evidence favors it.`,
    };
  }
  if (evidence.length > 0 && session.hypotheses.length === 0) {
    return {
      action: "analyze",
      reason:
        "All planned evidence has been collected but no hypothesis has been formed yet. Review get_investigation_timeline and call update_investigation with addHypothesis.",
    };
  }

  if (evidence.length === 0) {
    return {
      action: "stop",
      reason: "blocked",
      detail:
        "No evidence has been collected and the plan has no more pending steps — the investigation is likely blocked (e.g. Apty runtime/Studio diagnostics unavailable on this page/environment). Report what was attempted and why it's inconclusive rather than guessing.",
    };
  }

  return {
    action: "stop",
    reason: "evidence_exhausted",
    detail:
      "All plan steps are done or skipped and evidence has been collected, but no hypothesis reached a confirmable state. Report the best-supported conclusion at whatever confidence level (likely/possible/unknown) the evidence actually supports.",
  };
}
