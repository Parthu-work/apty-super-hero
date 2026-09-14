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
import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import {
  correlateEvidence,
  formatTimeline,
} from "../apty/evidence-correlation.js";
import { clearEvidence, getEvidence } from "../apty/evidence-store.js";
import {
  getInvestigation,
  recordVerificationAttempt,
  startInvestigation,
  stopInvestigation,
  updateInvestigation,
} from "../apty/investigation-session.js";
import type { ToolRunContext } from "./tab-utils";

const APTY_COMPONENT_KINDS = [
  "apty-client",
  "apty-widget",
  "apty-studio",
  "service-worker",
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
    "Start a first-class investigation for this conversation: records the user's reported problem and (optionally) which Apty components you already suspect are involved, and puts the investigation into an explicit lifecycle you update as you make progress. " +
    "Call this once, early, as soon as you begin actually investigating a reported Apty/browser issue (not for casual questions that don't need one). Calling it again replaces the previous investigation for this conversation — evidence already collected (get_investigation_timeline) is unaffected and stays available.",
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
        "Apty components you already suspect are involved, if apparent from the user's report. Leave empty if not yet known — use update_investigation to add one later as evidence narrows it down.",
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
    const investigation = startInvestigation({
      conversationId: runContext.conversationId,
      tabId: runContext.tabId,
      userProblem,
      suspectedComponents,
    });
    return { started: true, investigation };
  },
});

export const updateInvestigationTool = tool({
  name: "update_investigation",
  description:
    "Update the current investigation's lifecycle state. Only pass the fields you're actually changing. " +
    "Move status to 'collecting_evidence' while you gather evidence, 'analyzing' once you're reasoning over what you've collected, 'verifying' when checking a hypothesis, and 'resolved'/'failed' once you're done (or use stop_investigation). " +
    "Use addHypothesis to record a candidate explanation as you form it, addSuspectedComponent to note an Apty component the evidence points to, and diagnosis+confidence once you've reached a conclusion (confidence must be one of confirmed/likely/possible/unknown, matching the required diagnosis format). " +
    "Requires an investigation already started with start_investigation.",
  parameters: z.object({
    status: z.enum(INVESTIGATION_STATUSES).optional(),
    addHypothesis: z.string().optional(),
    addSuspectedComponent: z.enum(APTY_COMPONENT_KINDS).optional(),
    diagnosis: z.string().optional(),
    confidence: z
      .enum(["confirmed", "likely", "possible", "unknown"])
      .optional(),
  }),
  execute: async (patch, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const investigation = updateInvestigation(conversationId, patch);
    if (!investigation) {
      return {
        updated: false,
        message:
          "No active investigation for this conversation. Call start_investigation first.",
      };
    }
    return { updated: true, investigation };
  },
});

export const recordVerificationAttemptTool = tool({
  name: "record_verification_attempt",
  description:
    "Record the outcome of an attempt to verify the current diagnosis — e.g. re-checking the Widget's status, re-running the failed request, or re-inspecting the console after the fact. " +
    "Use 'confirmed' when the re-check supports the diagnosis, 'not_confirmed' when it contradicts it (the diagnosis should then be revised, not treated as still correct), 'inconclusive' when the check didn't produce a clear answer. " +
    "Requires an investigation already started with start_investigation.",
  parameters: z.object({
    outcome: z.enum(["confirmed", "not_confirmed", "inconclusive"]),
    notes: z
      .string()
      .optional()
      .describe("What the re-check actually found, briefly."),
  }),
  execute: async ({ outcome, notes }, context) => {
    const conversationId = (context as ToolRunContext)?.context?.conversationId;
    const investigation = recordVerificationAttempt(conversationId, {
      outcome,
      notes,
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

export const investigationTools = [
  getInvestigationTimelineTool,
  clearInvestigationEvidenceTool,
  startInvestigationTool,
  updateInvestigationTool,
  recordVerificationAttemptTool,
  stopInvestigationTool,
  getInvestigationStatusTool,
];
