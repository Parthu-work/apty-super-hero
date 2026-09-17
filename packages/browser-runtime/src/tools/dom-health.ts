/**
 * Apty DOM Health / DOM Readiness tool.
 *
 * Thin wrapper around `../apty/dom-health.js`'s `runDomHealthAudit` — the
 * exact same function the side panel's "Check DOM Health" button calls
 * directly (no agent turn involved). Exposing it as a tool too lets the
 * agent run (or explain) the same deterministic audit when asked in chat,
 * e.g. "check DOM health" or "why is the readiness score low" — it must
 * never invent a different score, only report what this tool returns.
 */
import { tool } from "@aipexstudio/aipex-core";
import { z } from "zod";
import { recordToolCall, runDomHealthAudit } from "../apty/index.js";
import { resolveDiagnosticTab, type ToolRunContext } from "./tab-utils";

export const runDomHealthAuditTool = tool({
  name: "run_dom_health_audit",
  description:
    "Run an explicit Apty DOM Readiness audit of the current tab's page: takes three DOM snapshots over a few seconds, simulates Apty-style element-selection (candidate generation, live uniqueness/target-identity verification, ignore/partial/contextual recovery, cross-snapshot stability, 9-point hit testing), and returns a deterministic 0-100 Apty DOM Readiness Score with a confidence level, manual-selector-dependency estimate, evidence-backed risks, and recommendations. " +
    "This score is calculated by code, not by you — always report the score, confidence, metrics, risks, and recommendations exactly as returned; never calculate your own score or invent metrics/evidence that aren't in the result. " +
    "Use this when asked to check DOM health/readiness, or to explain why a readiness score is low — call it again to get a fresh, current result rather than guessing. " +
    "Independent of Apty Client/Studio/Service-Worker state — it only reads the page's own DOM, so it works even when those integrations are unavailable.",
  parameters: z.object({}),
  execute: async (_input, context) => {
    recordToolCall(
      (context as ToolRunContext)?.context?.conversationId,
      "run_dom_health_audit",
      {},
    );
    const tab = await resolveDiagnosticTab(context as ToolRunContext);
    if (!tab.id) {
      return { available: false, error: "No active tab found." };
    }
    return runDomHealthAudit(tab.id);
  },
});

export const domHealthTools = [runDomHealthAuditTool];
