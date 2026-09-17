/**
 * Investigation timeline tools.
 *
 * Every diagnostic tool in `apty.ts`/`devtools.ts` records warn/error-level
 * findings into a per-conversation evidence store
 * (`../apty/evidence-store.ts`) as a side effect. These tools expose that
 * store back to the model as a *deterministically correlated* timeline
 * (`../apty/evidence-correlation.ts`) — grouped by shared request/
 * correlation ids or by time-window proximity — instead of leaving the
 * model to reconstruct relationships between scattered raw tool outputs
 * from scratch on every turn.
 *
 * This is a pre-pass, not a diagnosis: it narrows and organizes the
 * model's search space (see `likelySameIncident` on each cluster) but
 * still leaves the actual root-cause reasoning, verification, and
 * confidence rating to the model, per the system prompt's
 * CONFIRMED/LIKELY/POSSIBLE/UNKNOWN discipline.
 */
import { tool } from "@apty/agent-core";
import { z } from "zod";
import {
  correlateEvidence,
  formatTimeline,
} from "../apty/evidence-correlation.js";
import { clearEvidence, getEvidence } from "../apty/evidence-store.js";
import { decideNextAction } from "../apty/investigation-orchestrator.js";
import { planInvestigation } from "../apty/investigation-planner.js";
import {
  getInvestigation,
  recordVerificationAttempt,
  startInvestigation,
  stopInvestigation,
  updateInvestigation,
} from "../apty/investigation-session.js";
import type { ToolRunContext } from "./tab-utils";

/**
 * Apty ships two extensions: Studio (authoring), and one runtime extension
 * that goes by several names (Client/Widget/Player) but is architecturally
 * one component — see `investigation-session.ts`'s `AptyComponentKind` doc
 * comment. Don't reintroduce a 4-way split here.
 */
const APTY_COMPONENT_KINDS = [
  "apty-client-widget-player",
  "apty-studio",
] as const;

const INVESTIGATION_STATUSES = [
  "starting",
  "investigating",
  "collecting_evidence",
  "analyzing",
  "verifying",
  "resolved",
  "failed",
] as const;

const HYPOTHESIS_STATUSES = [
  "open",
  "testing",
  "supported",
  "rejected",
  "confirmed",
  "inconclusive",
] as const;

export const getInvestigationTimelineTool = tool({
  name: "get_investigation_timeline",
  description:
    "Get a deterministically correlated timeline of all diagnostic evidence (console/runtime errors, failed network requests, Apty Widget/Client/Studio/Service-Worker findings) collected so far in this conversation. " +
    "Evidence that happened close together in time (or shares a network request id) is grouped into clusters, with clusters spanning more than one source (e.g. a failed network request plus a console error) flagged as likely the same incident. " +
    "Call diagnostic tools first (get_apty_page_logs, get_network_diagnostics, get_apty_widget_diagnostics, etc.) — this tool only correlates what's already been collected, it does not gather new evidence itself.",
  parameters: z.object({
    windowMs: z
      .number()
      .int()
      .min(100)
      .max(30000)
      .default(2000)
      .describe(
        "Maximum gap in milliseconds between two events for them to be grouped into the same cluster when they don't share an explicit request/correlation id (default 2000ms)",
      ),
  }),
  execute: async ({ windowMs }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const evidence = getEvidence(conversationId);

    if (evidence.length === 0) {
      return {
        available: false,
        message:
          "No diagnostic evidence collected yet in this conversation. Call a diagnostic tool first (get_apty_page_logs, get_network_diagnostics, get_runtime_diagnostics, get_apty_widget_diagnostics, get_apty_client_diagnostics, get_apty_studio_diagnostics, or get_apty_service_worker_diagnostics), then call this tool again.",
      };
    }

    const clusters = correlateEvidence(evidence, { windowMs });

    return {
      available: true,
      evidenceCount: evidence.length,
      clusterCount: clusters.length,
      likelyIncidentClusterCount: clusters.filter((c) => c.likelySameIncident)
        .length,
      timeline: formatTimeline(clusters),
      clusters,
    };
  },
});

export const clearInvestigationEvidenceTool = tool({
  name: "clear_investigation_evidence",
  description:
    "Clear all diagnostic evidence collected so far in this conversation, discarding the correlated timeline. " +
    "Use this when starting a fresh investigation within the same chat (e.g. the user says 'let's look at a different issue now') so old, unrelated evidence doesn't get correlated with new findings.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const clearedCount = getEvidence(conversationId).length;
    clearEvidence(conversationId);
    return { cleared: true, clearedCount };
  },
});

export const startInvestigationTool = tool({
  name: "start_investigation",
  description:
    "Start a first-class investigation for this conversation: records the user's reported problem and (optionally) which Apty component you already suspect is involved, generates a deterministic investigation plan (an ordered checklist matched against known problem patterns — tooltip not showing, Studio can't select an element, works in Studio but not production, workflow not triggering, widget not loading — or a generic host-app/Apty-runtime/Studio checklist otherwise), and puts the investigation into an explicit lifecycle you update as you make progress. " +
    "Call this once, early, as soon as you begin actually investigating a reported Apty/browser issue (not for casual questions that don't need one). Calling it again replaces the previous investigation for this conversation — evidence already collected (get_investigation_timeline) is unaffected and stays available. " +
    "The generated plan is a starting point, not a constraint — you are not required to follow it verbatim or in order; call get_investigation_plan to see it, and mark steps done/skipped via update_investigation as you go.",
  parameters: z.object({
    userProblem: z
      .string()
      .min(1)
      .describe(
        "The problem the user reported, in their own words or a faithful summary (e.g. 'Widget not showing on the Accounts page').",
      ),
    suspectedComponents: z
      .array(z.enum(APTY_COMPONENT_KINDS))
      .optional()
      .describe(
        "The Apty component(s) you already suspect are involved, if apparent from the user's report: 'apty-client-widget-player' for the runtime extension (Client/Widget/Player, including its service worker), 'apty-studio' for the authoring extension. Leave empty if not yet known — use update_investigation to add one later as evidence narrows it down.",
      ),
  }),
  execute: async ({ userProblem, suspectedComponents }, context) => {
    const runContext = (context as ToolRunContext)?.context;
    if (!runContext?.conversationId) {
      return {
        started: false,
        message:
          "No conversation context is available yet — cannot start an investigation.",
      };
    }
    const plan = planInvestigation(userProblem);
    const investigation = startInvestigation({
      conversationId: runContext.conversationId,
      tabId: runContext.tabId,
      userProblem,
      suspectedComponents,
      plan,
    });
    return { started: true, investigation };
  },
});

export const getInvestigationPlanTool = tool({
  name: "get_investigation_plan",
  description:
    "Get the current investigation's plan — the ordered checklist of investigation steps (with suggested tools for each) generated by start_investigation, and which steps are still pending vs. done/skipped. " +
    "Use this to decide what to investigate next rather than guessing; the plan is advisory, not mandatory — deviate from it when the evidence points somewhere the plan didn't anticipate.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const investigation = getInvestigation(conversationId);
    if (!investigation) {
      return {
        available: false,
        message:
          "No active investigation for this conversation. Call start_investigation first.",
      };
    }
    if (!investigation.plan) {
      return {
        available: false,
        message:
          "This investigation has no plan recorded (started before planning was added, or no plan was generated).",
      };
    }
    const pendingCount = investigation.plan.steps.filter(
      (s) => s.status === "pending",
    ).length;
    return {
      available: true,
      category: investigation.plan.category,
      pendingCount,
      plan: investigation.plan,
    };
  },
});

export const updateInvestigationTool = tool({
  name: "update_investigation",
  description:
    "Update the current investigation's lifecycle state. Only pass the fields you're actually changing. " +
    "Move status to 'collecting_evidence' while you gather evidence, 'analyzing' once you're reasoning over what you've collected, 'verifying' when checking a hypothesis, and 'resolved'/'failed' once you're done (or use stop_investigation). " +
    "Use addHypothesis to record a new candidate explanation (starts as status 'open', confidence 'unknown'); use updateHypothesis to move an existing hypothesis through open → testing → supported/rejected/confirmed/inconclusive as you gather evidence for or against it, citing evidenceIds from get_investigation_timeline. " +
    "Use addSuspectedComponent to note which Apty component ('apty-client-widget-player' or 'apty-studio') the evidence points to, and completedPlanStepId/skippedPlanStepId to track progress against get_investigation_plan's checklist. " +
    "Set diagnosis+confidence once you've reached a conclusion (confidence must be one of confirmed/likely/possible/unknown, matching the required diagnosis format) — NOTE: confidence 'confirmed' is only accepted if a verification attempt with outcome 'confirmed' has already been recorded via record_verification_attempt in this investigation; otherwise it is automatically downgraded to 'likely'. Never state 'confirmed' to the user unless the returned investigation.confidence actually says 'confirmed'. " +
    "Requires an investigation already started with start_investigation.",
  parameters: z.object({
    status: z.enum(INVESTIGATION_STATUSES).optional(),
    addHypothesis: z.string().optional(),
    updateHypothesis: z
      .object({
        id: z
          .string()
          .describe(
            "The hypothesis id from a prior update_investigation/get_investigation_status result",
          ),
        status: z.enum(HYPOTHESIS_STATUSES).optional(),
        confidence: z
          .enum(["confirmed", "likely", "possible", "unknown"])
          .optional(),
        addSupportingEvidenceId: z
          .string()
          .optional()
          .describe(
            "An evidenceId (from get_investigation_timeline) that supports this hypothesis",
          ),
        addContradictingEvidenceId: z
          .string()
          .optional()
          .describe(
            "An evidenceId (from get_investigation_timeline) that contradicts this hypothesis",
          ),
      })
      .optional(),
    addSuspectedComponent: z.enum(APTY_COMPONENT_KINDS).optional(),
    diagnosis: z.string().optional(),
    confidence: z
      .enum(["confirmed", "likely", "possible", "unknown"])
      .optional(),
    completedPlanStepId: z
      .string()
      .optional()
      .describe("Mark a step from get_investigation_plan as done"),
    skippedPlanStepId: z
      .string()
      .optional()
      .describe(
        "Mark a step from get_investigation_plan as not applicable/skipped",
      ),
  }),
  execute: async (patch, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const requestedConfidence = patch.confidence;
    const investigation = updateInvestigation(conversationId, patch);
    if (!investigation) {
      return {
        updated: false,
        message:
          "No active investigation for this conversation. Call start_investigation first.",
      };
    }
    const confidenceDowngraded =
      requestedConfidence === "confirmed" &&
      investigation.confidence !== "confirmed";
    return {
      updated: true,
      investigation,
      ...(confidenceDowngraded
        ? {
            warning:
              "Confidence 'confirmed' was requested but no confirmed verification attempt exists yet for this investigation — downgraded to 'likely'. Call record_verification_attempt with outcome 'confirmed' first if the diagnosis is actually verified.",
          }
        : {}),
    };
  },
});

export const recordVerificationAttemptTool = tool({
  name: "record_verification_attempt",
  description:
    "Record the outcome of an attempt to verify a hypothesis or the current diagnosis — e.g. re-checking the Apty Client/Widget/Player's status, re-testing a selector with analyze_element_selectors, re-running the failed request, or re-inspecting the console after the fact. Prefer a real, deterministic check (a tool call whose result is unambiguous) over re-reading the same evidence again. " +
    "Use 'confirmed' when the re-check supports the hypothesis/diagnosis, 'not_confirmed' when it contradicts it (the hypothesis is then rejected, not treated as still correct — do not keep asserting a rejected hypothesis), 'inconclusive' when the check didn't produce a clear answer. " +
    "Pass hypothesisId (from update_investigation/get_investigation_status) to link this attempt to a specific hypothesis — its status is then updated automatically ('confirmed'→confirmed, 'not_confirmed'→rejected, 'inconclusive'→testing). " +
    "A 'confirmed' outcome here is also what allows update_investigation's overall diagnosis confidence to actually be set to 'confirmed' rather than being downgraded to 'likely'. " +
    "Requires an investigation already started with start_investigation.",
  parameters: z.object({
    outcome: z.enum(["confirmed", "not_confirmed", "inconclusive"]),
    notes: z
      .string()
      .optional()
      .describe("What the re-check actually found, briefly."),
    hypothesisId: z
      .string()
      .optional()
      .describe("The hypothesis this attempt was testing, if any."),
  }),
  execute: async ({ outcome, notes, hypothesisId }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const investigation = recordVerificationAttempt(conversationId, {
      outcome,
      notes,
      hypothesisId,
    });
    if (!investigation) {
      return {
        recorded: false,
        message:
          "No active investigation for this conversation. Call start_investigation first.",
      };
    }
    return { recorded: true, investigation };
  },
});

export const stopInvestigationTool = tool({
  name: "stop_investigation",
  description:
    "Stop the current investigation. Use 'resolved' once the issue is explained/fixed, 'failed' when the investigation could not determine a cause, or 'stopped' (default) when the user asked to stop or cancel. " +
    "Evidence collected during the investigation is not discarded — it remains available in this conversation (see get_investigation_timeline).",
  parameters: z.object({
    status: z.enum(["stopped", "resolved", "failed"]).default("stopped"),
  }),
  execute: async ({ status }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const investigation = stopInvestigation(conversationId, status);
    if (!investigation) {
      return {
        stopped: false,
        message: "No active investigation for this conversation.",
      };
    }
    return { stopped: true, investigation };
  },
});

export const getInvestigationStatusTool = tool({
  name: "get_investigation_status",
  description:
    "Get the current investigation's lifecycle state — status, the user's reported problem, suspected Apty components, hypotheses recorded so far, diagnosis and confidence if any, and verification attempts — plus how much evidence has been collected. " +
    "Call this to check where the investigation currently stands, e.g. before deciding whether to keep collecting evidence, move to verification, or report a conclusion.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const investigation = getInvestigation(conversationId);
    const evidenceCount = getEvidence(conversationId).length;
    if (!investigation) {
      return {
        active: false,
        evidenceCount,
        message:
          "No investigation has been started in this conversation yet. Call start_investigation to begin one.",
      };
    }
    return { active: true, evidenceCount, investigation };
  },
});

export const getNextInvestigationActionTool = tool({
  name: "get_next_investigation_action",
  description:
    "Get a deterministic recommendation for what to do next in the current investigation — the autonomous orchestration layer on top of the plan/hypotheses/evidence you already have. " +
    "Combines the investigation's plan (get_investigation_plan), its hypotheses, and which diagnostic tools have actually been called to return exactly one of: " +
    "call_tool (call this specific tool next, with why), verify (a hypothesis has support and should be verified via record_verification_attempt), analyze (evidence/hypotheses need reasoning, not more tool calls), or stop (with a reason: confirmed, budget_exceeded, loop_detected, blocked, or evidence_exhausted). " +
    "Enforces hard guardrails server-side so the investigation cannot run away: a maximum number of diagnostic tool calls, a wall-clock time budget, and duplicate-call (loop) detection — when a stop reason is returned, do not keep calling diagnostic tools; report the best-supported conclusion at an honest confidence level instead. " +
    "Call this after start_investigation and again after each round of evidence collection, instead of guessing what to check next. " +
    "Requires an investigation already started with start_investigation.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const investigation = getInvestigation(conversationId);
    if (!investigation) {
      return {
        available: false,
        message:
          "No active investigation for this conversation. Call start_investigation first.",
      };
    }
    const evidence = getEvidence(conversationId);
    const nextAction = decideNextAction(investigation, evidence);
    return { available: true, evidenceCount: evidence.length, nextAction };
  },
});

export const investigationTools = [
  getInvestigationTimelineTool,
  clearInvestigationEvidenceTool,
  startInvestigationTool,
  getInvestigationPlanTool,
  updateInvestigationTool,
  recordVerificationAttemptTool,
  stopInvestigationTool,
  getInvestigationStatusTool,
  getNextInvestigationActionTool,
];
