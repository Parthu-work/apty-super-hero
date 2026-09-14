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
import type { ToolRunContext } from "./tab-utils";

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

export const investigationTools = [
  getInvestigationTimelineTool,
  clearInvestigationEvidenceTool,
];
